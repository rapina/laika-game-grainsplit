/**
 * Deterministic run engine for 결 가르기.
 *
 * Seeded RNG + fixed 1/60s step. Nothing here renders or reads wall-clock time;
 * elapsed time is only ever accumulated ticks x STEP_MS. The Pixi runtime, the
 * unit tests and scripts/playability-sim.mjs all drive this same `step`/`tap`.
 */

import { BANDS, FAILURE_BUDGET, TOTAL_LOGS, bandForLog, type Band } from './bands'
import {
    STEP_MS, clampAngle, advanceMultiplier, tapAccuracy, timingTier,
    signedPhaseErrorMs, fibreAt, encodeScore, standardDeviation, mean, type Tier,
} from './rules'

export { STEP_MS, TOTAL_LOGS, FAILURE_BUDGET, BANDS }
export type { Band, Tier }

/** Wedge re-cocks after a strike; taps inside this are ignored, and it is drawn. */
export const TAP_LOCKOUT_MS = 180

/** Resolution animation length per outcome, in milliseconds. */
export const RESOLVE_MS = { split: 1100, shatter: 1300, short: 950 } as const

export type LogOutcome = 'split' | 'shatter' | 'short'

export interface Knot {
    /** Position along the log, 0..1. */
    p: number
    /** Radians the crack kinks by when it crosses. */
    kink: number
}

export interface TapRecord {
    logIndex: number
    /** Signed timing error vs the recoil peak. Negative = early. */
    errorMs: number
    absErrorMs: number
    tier: Tier
    accuracy: number
    multiplier: number
    /** Crack tip after the tap, 0..1. */
    crackP: number
}

export interface LogState {
    index: number
    band: Band
    /** Target band centre, as a fraction of log length. */
    bandCenter: number
    bandWidth: number
    /** Full-strength advance per tap. */
    baseAdvance: number
    tapBudget: number
    tapsUsed: number
    crackP: number
    crackAngle: number
    knots: Knot[]
    crossedKnots: number
    /** Seeded fibre control nodes, -1..1. Drawn as the bent fibre lines. */
    fibreNodes: number[]
    /** Time inside the current recoil cycle. Peak is phase 0. */
    phaseMs: number
    cycleIndex: number
    currentPeriodMs: number
    lockoutMs: number
    outcome: LogOutcome | null
    resolveMs: number
    /** Sticky correction cue for this log. Always rendered while the log lives. */
    lastTap: TapRecord | null
}

export interface FailureMark {
    logIndex: number
    bandIndex: number
    outcome: 'shatter' | 'short'
    /** Distance from the crack tip to the near/far band edge, as a fraction. */
    delta: number
}

export interface PileEntry {
    logIndex: number
    bandIndex: number
    outcome: LogOutcome
    /** True when the split was landed with a 결 tap. */
    grain: boolean
}

export interface RunState {
    seed: string
    rngState: number
    logIndex: number
    log: LogState
    splits: number
    grainSplits: number
    failures: number
    preciseCount: number
    taps: TapRecord[]
    /** Accumulated ticks x STEP_MS. The only clock in the engine. */
    elapsedMs: number
    ticks: number
    /** Recoil is frozen until the first tap. */
    started: boolean
    over: boolean
    endReason: 'complete' | 'wedgesGone' | null
    /** Guide stays up until 2 successes; returns after 2 consecutive failures. */
    guideVisible: boolean
    successesSinceGuide: number
    consecutiveFailures: number
    /** Everything this run made, split and ruined alike. Never cleared. */
    pile: PileEntry[]
    /** Last failed log: which band, and how far off in which direction. */
    lastFailure: FailureMark | null
}

// ---------------------------------------------------------------- rng

function hashSeed(seed: string): number {
    let h = 1779033703 ^ seed.length
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
}

function nextRandom(state: RunState): number {
    state.rngState = (state.rngState + 0x6d2b79f5) >>> 0
    let t = state.rngState
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function range(state: RunState, lo: number, hi: number): number {
    return lo + nextRandom(state) * (hi - lo)
}

// ---------------------------------------------------------------- log build

function periodForCycle(log: LogState, cycleIndex: number): number {
    const base = log.band.recoilPeriodMs
    if (log.band.jitter <= 0) return base
    // Deterministic per-cycle jitter from the log index and cycle number, so a
    // seeded run replays identically no matter how the caller steps it.
    const h = hashSeed(`${log.index}:${cycleIndex}`)
    const unit = (h % 10000) / 10000 // 0..1
    return base * (1 + log.band.jitter * (unit * 2 - 1))
}

function buildLog(state: RunState, index: number): LogState {
    const band = bandForLog(index)
    const bandCenter = range(state, 0.56, 0.82)
    const knotCount = band.knotsMin + Math.floor(nextRandom(state) * (band.knotsMax - band.knotsMin + 1))
    const knots: Knot[] = []
    for (let i = 0; i < knotCount; i++) {
        knots.push({
            p: range(state, 0.18, Math.max(0.2, bandCenter - 0.06)),
            kink: (nextRandom(state) < 0.5 ? -1 : 1) * range(state, 0.18, 0.18 + band.grainBias),
        })
    }
    knots.sort((a, b) => a.p - b.p)
    const fibreNodes: number[] = []
    for (let i = 0; i < 6; i++) fibreNodes.push(range(state, -1, 1))

    const log: LogState = {
        index,
        band,
        bandCenter,
        bandWidth: band.bandWidth,
        baseAdvance: bandCenter / band.plannedTaps,
        tapBudget: band.plannedTaps + 2,
        tapsUsed: 0,
        crackP: 0,
        crackAngle: 0,
        knots,
        crossedKnots: 0,
        fibreNodes,
        phaseMs: 0,
        cycleIndex: 0,
        currentPeriodMs: band.recoilPeriodMs,
        lockoutMs: 0,
        outcome: null,
        resolveMs: 0,
        lastTap: null,
    }
    log.currentPeriodMs = periodForCycle(log, 0)
    // Start just past the bottom of the recoil, so the first peak is very
    // nearly a half cycle away and the signed error starts unambiguously early.
    log.phaseMs = log.currentPeriodMs / 2 + 1
    return log
}

// ---------------------------------------------------------------- run

export function createRun(seed: string | number = '1'): RunState {
    const s = String(seed)
    const state: RunState = {
        seed: s,
        rngState: hashSeed(s),
        logIndex: 1,
        log: null as unknown as LogState,
        splits: 0,
        grainSplits: 0,
        failures: 0,
        preciseCount: 0,
        taps: [],
        elapsedMs: 0,
        ticks: 0,
        started: false,
        over: false,
        endReason: null,
        guideVisible: true,
        successesSinceGuide: 0,
        consecutiveFailures: 0,
        pile: [],
        lastFailure: null,
    }
    state.log = buildLog(state, 1)
    return state
}

export function bandNear(log: LogState): number { return log.bandCenter - log.bandWidth / 2 }
export function bandFar(log: LogState): number { return log.bandCenter + log.bandWidth / 2 }

/** Current signed timing error if a tap landed right now. Drives the ring on screen. */
export function currentErrorMs(log: LogState): number {
    return signedPhaseErrorMs(log.phaseMs, log.currentPeriodMs)
}

/** True while the pale green ring is open (inside the success window). */
export function ringOpen(log: LogState): boolean {
    return Math.abs(currentErrorMs(log)) <= log.band.successWindowMs
}

/** Recoil height, -1 (bottom) .. 1 (peak). The wedge rides this. */
export function recoilHeight(log: LogState): number {
    const t = log.phaseMs / log.currentPeriodMs
    return Math.cos(t * Math.PI * 2)
}

function finishLog(state: RunState, outcome: LogOutcome): void {
    const log = state.log
    log.outcome = outcome
    log.resolveMs = RESOLVE_MS[outcome]
    const grain = outcome === 'split' && log.lastTap?.tier === 'grain'
    state.pile.push({ logIndex: log.index, bandIndex: log.band.index, outcome, grain })

    if (outcome === 'split') {
        state.splits += 1
        if (grain) state.grainSplits += 1
        state.consecutiveFailures = 0
        if (state.guideVisible) {
            state.successesSinceGuide += 1
            if (state.successesSinceGuide >= 2) state.guideVisible = false
        }
    } else {
        state.failures += 1
        state.consecutiveFailures += 1
        state.lastFailure = {
            logIndex: log.index,
            bandIndex: log.band.index,
            outcome,
            delta: outcome === 'shatter' ? log.crackP - bandFar(log) : bandNear(log) - log.crackP,
        }
        if (state.consecutiveFailures >= 2) {
            state.guideVisible = true
            state.successesSinceGuide = 0
        }
    }
}

function advanceToNextLog(state: RunState): void {
    if (state.failures >= FAILURE_BUDGET) {
        state.over = true
        state.endReason = 'wedgesGone'
        return
    }
    if (state.logIndex >= TOTAL_LOGS) {
        state.over = true
        state.endReason = 'complete'
        return
    }
    state.logIndex += 1
    state.log = buildLog(state, state.logIndex)
}

/**
 * Advance one fixed step. Frozen before the first tap and after the run ends,
 * so a guide can sit on screen without the clock running.
 */
export function step(state: RunState, dtMs: number = STEP_MS): void {
    if (state.over || !state.started) return
    state.ticks += 1
    state.elapsedMs = state.ticks * dtMs
    const log = state.log

    if (log.outcome !== null) {
        log.resolveMs -= dtMs
        if (log.resolveMs <= 0) advanceToNextLog(state)
        return
    }

    if (log.lockoutMs > 0) log.lockoutMs = Math.max(0, log.lockoutMs - dtMs)

    log.phaseMs += dtMs
    while (log.phaseMs >= log.currentPeriodMs) {
        log.phaseMs -= log.currentPeriodMs
        log.cycleIndex += 1
        log.currentPeriodMs = periodForCycle(log, log.cycleIndex)
    }
}

export interface TapResult extends TapRecord {
    /** Outcome this tap caused, if it ended the log. */
    outcome: LogOutcome | null
    knotHit: boolean
}

/**
 * Drive a wedge. Returns null when the tap was swallowed (run over, mid-resolve,
 * or inside the re-cock lockout) — those do not burn the tap budget.
 *
 * The first tap of a run also starts the clock; before it, `step` is a no-op.
 */
export function tap(state: RunState): TapResult | null {
    if (state.over) return null
    if (!state.started) {
        state.started = true
        return null
    }
    const log = state.log
    if (log.outcome !== null) return null
    if (log.lockoutMs > 0) return null

    const errorMs = currentErrorMs(log)
    const absErrorMs = Math.abs(errorMs)
    const tier = timingTier(absErrorMs, log.band)
    const multiplier = advanceMultiplier(absErrorMs, log.band)
    const accuracy = tapAccuracy(absErrorMs, log.band)

    log.tapsUsed += 1
    log.lockoutMs = TAP_LOCKOUT_MS

    let knotHit = false
    if (multiplier > 0) {
        // Fibre field bends the crack; a precise strike halves the bend and
        // straightens what the crack already picked up.
        const straightens = absErrorMs <= log.band.precisionWindowMs
        const biasScale = straightens ? 0.5 : 1
        if (straightens) log.crackAngle *= 0.5
        log.crackAngle = clampAngle(log.crackAngle + log.band.grainBias * biasScale * fibreAt(log.fibreNodes, log.crackP))

        const from = log.crackP
        const advance = log.baseAdvance * multiplier * Math.cos(log.crackAngle)
        let to = from + advance
        for (const knot of log.knots) {
            if (knot.p > from && knot.p <= to) {
                knotHit = true
                log.crackAngle = clampAngle(log.crackAngle + knot.kink)
                log.crossedKnots += 1
                // Kinking at a knot costs the rest of this tap's reach.
                to = knot.p + (to - knot.p) * Math.cos(log.crackAngle)
            }
        }
        log.crackP = Math.min(1, to)
    }

    // 결 only fires when this tap is also the one that parks the tip in the band.
    const inBand = log.crackP >= bandNear(log) && log.crackP <= bandFar(log)
    const finalTier: Tier = tier === 'grain' && !inBand ? 'precise' : tier

    const record: TapRecord = {
        logIndex: log.index,
        errorMs,
        absErrorMs,
        tier: finalTier,
        accuracy,
        multiplier,
        crackP: log.crackP,
    }
    log.lastTap = record
    state.taps.push(record)
    if (finalTier === 'precise' || finalTier === 'grain') state.preciseCount += 1

    let outcome: LogOutcome | null = null
    if (inBand) outcome = 'split'
    else if (log.crackP > bandFar(log)) outcome = 'shatter'
    else if (log.tapsUsed >= log.tapBudget) outcome = 'short'
    if (outcome) finishLog(state, outcome)

    return { ...record, outcome, knotHit }
}

// ---------------------------------------------------------------- summary

export interface RunSummary {
    seed: string
    splits: number
    grainSplits: number
    totalLogs: number
    failures: number
    taps: number
    preciseCount: number
    avgAccuracy: number
    /** Standard deviation of the signed error. The swing, not a signed mean. */
    swingMs: number
    meanAbsErrorMs: number
    /** Kept only so it is never mistaken for the diagnosis. Not shown as one. */
    signedMeanErrorMs: number
    bandReached: number
    elapsedMs: number
    endReason: 'complete' | 'wedgesGone' | null
    score: number
}

export function summarize(state: RunState): RunSummary {
    const errors = state.taps.map((t) => t.errorMs)
    const avgAccuracy = mean(state.taps.map((t) => t.accuracy))
    return {
        seed: state.seed,
        splits: state.splits,
        grainSplits: state.grainSplits,
        totalLogs: TOTAL_LOGS,
        failures: state.failures,
        taps: state.taps.length,
        preciseCount: state.preciseCount,
        avgAccuracy,
        swingMs: standardDeviation(errors),
        meanAbsErrorMs: mean(state.taps.map((t) => t.absErrorMs)),
        signedMeanErrorMs: mean(errors),
        bandReached: state.log.band.index,
        elapsedMs: state.elapsedMs,
        endReason: state.endReason,
        score: encodeScore({ splits: state.splits, avgAccuracy, preciseCount: state.preciseCount }),
    }
}
