/**
 * Playability gate — can a person actually play this?
 *
 *   node scripts/playability-sim.mjs [runsPerPolicy]
 *
 * Two human models drive the REAL runtime: the engine TypeScript is bundled
 * with esbuild and its own `step`/`tap` are called tick by tick. Elapsed time
 * is only ever `ticks x STEP_MS` read back off the engine — no closed-form
 * re-derivation of timing, judgment or end conditions anywhere in this file.
 *
 * Information boundary: a policy only ever sees `observe()`, which exposes the
 * things the renderer actually draws (the ring open/closed, the wedge height,
 * the crack tip on the log, the painted band, the correction cue text, the
 * wedges and notches beside the cradle). Internal band numbers, base advance
 * and phase are NOT visible; the skilled policy has to measure them off the
 * screen the same way a person would, through perceptual noise.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ------------------------------------------------------------- load the real engine

const outDir = mkdtempSync(join(tmpdir(), 'grainsplit-sim-'))
const bundle = join(outDir, 'engine.mjs')
const build = spawnSync(
    join('node_modules', '.bin', 'esbuild'),
    [
        'src/game/grainsplit/engine.ts',
        '--bundle', '--format=esm', `--outfile=${bundle}`, '--platform=neutral',
    ],
    { encoding: 'utf-8' },
)
if (build.status !== 0) {
    console.error(build.stderr || build.stdout)
    throw new Error('failed to bundle the engine for the simulation')
}
const engine = await import(pathToFileURL(bundle).href)
const {
    createRun, step, tap, summarize, currentErrorMs, ringOpen, recoilHeight,
    bandNear, bandFar, STEP_MS, TOTAL_LOGS, FAILURE_BUDGET,
} = engine

// ------------------------------------------------------------- seeded noise

function makeRng(seed) {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Box-Muller. Every sample is recorded so the realized variance can be checked. */
function makeGaussian(rng, log) {
    let spare = null
    return (mu, sigma) => {
        let z
        if (spare !== null) { z = spare; spare = null }
        else {
            let u = 0, v = 0, s = 0
            do {
                u = rng() * 2 - 1
                v = rng() * 2 - 1
                s = u * u + v * v
            } while (s === 0 || s >= 1)
            const f = Math.sqrt((-2 * Math.log(s)) / s)
            z = u * f
            spare = v * f
        }
        const value = mu + sigma * z
        if (log) log.push(value)
        return value
    }
}

// ------------------------------------------------------------- what the screen shows

/**
 * Rendered-only view of the game. Anything not on this object is not on screen
 * and a policy may not use it.
 */
function observe(state, gauss) {
    const log = state.log
    // Reading a position off a textured log is not exact.
    const posNoise = () => gauss(0, 0.012)
    return {
        ringIsOpen: ringOpen(log),
        wedgeHeight: recoilHeight(log) + gauss(0, 0.04),
        crackTip: log.crackP + (log.crackP > 0 ? posNoise() : 0),
        bandNear: bandNear(log) + posNoise(),
        bandFar: bandFar(log) + posNoise(),
        // The correction cue is printed as a number, so it is read exactly.
        lastErrorMs: log.lastTap ? log.lastTap.errorMs : null,
        tapsLeft: log.tapBudget - log.tapsUsed,
        wedgesLeft: FAILURE_BUDGET - state.failures,
        logIndex: log.index,
        resolving: log.outcome !== null,
        over: state.over,
    }
}

// ------------------------------------------------------------- policies

const REACTION_MU = 200
const REACTION_SIGMA = 40

/**
 * Intuitive: plays exactly what the on-screen guide says, "tap when the green
 * ring opens". Sees the ring open, reacts, taps. No anticipation, no idea that
 * the advance can be shortened on purpose.
 */
function intuitivePolicy(gaussReaction) {
    let wasOpen = false
    return {
        decide(view, _tick, canAct) {
            const opened = view.ringIsOpen && !wasOpen
            wasOpen = view.ringIsOpen
            if (!opened || !canAct) return null
            return Math.max(0, gaussReaction(REACTION_MU, REACTION_SIGMA))
        },
        reset() { wasOpen = false },
    }
}

/**
 * Skilled: knows the trick the GDD intends. Watches the wedge rise so it can
 * anticipate the peak instead of reacting to it, measures the ring's open time
 * to judge how wide the window is, learns how far one full strike moves the
 * crack by watching the crack move, and deliberately strikes off-peak on the
 * approach so the last strike parks the tip inside the painted band.
 *
 * Everything it uses comes from `view`; it still pays a reaction delay and it
 * still has motor scatter.
 */
function skilledPolicy(gaussReaction, motor) {
    // Everything below is measured off the ring, which is drawn: it opens
    // exactly on entering the success window and closes on leaving it, so its
    // midpoint is the recoil peak and its span is the window width.
    let openStart = null
    let prevOpenStart = null
    let wasOpen = false
    let peakTick = null
    let openSpanMs = null
    let periodMs = null
    let advanceEstimate = null
    let tipBeforeTap = null
    let lastLog = null

    const reset = () => {
        openStart = null; prevOpenStart = null; wasOpen = false; peakTick = null
        openSpanMs = null; periodMs = null; advanceEstimate = null; tipBeforeTap = null
    }

    return {
        reset() { reset(); lastLog = null },
        decide(view, tick, canAct) {
            if (view.logIndex !== lastLog) { lastLog = view.logIndex; reset() }

            // --- watch the ring's edges
            if (view.ringIsOpen && !wasOpen) {
                prevOpenStart = openStart
                openStart = tick
                if (prevOpenStart !== null) {
                    const span = (openStart - prevOpenStart) * STEP_MS
                    periodMs = periodMs === null ? span : periodMs * 0.5 + span * 0.5
                }
            } else if (!view.ringIsOpen && wasOpen && openStart !== null) {
                openSpanMs = (tick - openStart) * STEP_MS
                peakTick = (openStart + tick) / 2
            }
            wasOpen = view.ringIsOpen

            // --- learn how far one full strike moves the crack, by watching it move
            if (tipBeforeTap !== null && view.lastErrorMs !== null && openSpanMs !== null) {
                const moved = view.crackTip - tipBeforeTap
                if (moved > 0.005) {
                    const halfWindow = openSpanMs / 2
                    const precisionHalf = halfWindow * 0.32 // the inner solid arc
                    const abs = Math.abs(view.lastErrorMs)
                    const m = abs <= precisionHalf
                        ? 1
                        : Math.max(0.6, 1 - 0.4 * (abs - precisionHalf) / Math.max(1, halfWindow - precisionHalf))
                    const full = moved / m
                    advanceEstimate = advanceEstimate === null ? full : advanceEstimate * 0.5 + full * 0.5
                }
                tipBeforeTap = null
            }

            if (!canAct) return null
            if (periodMs === null || openSpanMs === null || peakTick === null) return null

            // --- aim at the next peak, anticipating rather than reacting
            const toNextPeak = (peakTick + periodMs / STEP_MS - tick) * STEP_MS
            const reaction = gaussReaction(REACTION_MU, REACTION_SIGMA)
            if (toNextPeak < reaction + STEP_MS) return null

            const halfWindow = openSpanMs / 2
            const precisionHalf = halfWindow * 0.32

            // --- decide how hard to strike so the last one parks in the band
            let wantOffset = 0
            if (advanceEstimate !== null && advanceEstimate > 0) {
                const bandMid = (view.bandNear + view.bandFar) / 2
                const remaining = bandMid - view.crackTip
                let m = remaining / advanceEstimate
                // Full strength while the band is still far; only shape the
                // strike on the final approach, and never walk into the dead
                // zone where even the weakest strike would overshoot.
                if (m >= 1.35) m = 1
                else if (m > 1) m = m / 2
                m = Math.max(0.6, Math.min(1, m))
                if (m < 0.995) {
                    const raw = precisionHalf + ((1 - m) / 0.4) * (halfWindow - precisionHalf)
                    // Keep clear of the window edge; a miss here wastes the tap.
                    wantOffset = Math.min(raw, halfWindow * 0.78)
                    if (motor(0, 1) < 0) wantOffset = -wantOffset
                }
            }

            const aim = toNextPeak + wantOffset + motor(0, 18)
            if (aim < reaction) return null
            tipBeforeTap = view.crackTip
            return aim
        },
    }
}

// ------------------------------------------------------------- driver

const MAX_TICKS = Math.ceil(180_000 / STEP_MS) // manifest maxSeconds

function runOnce(policyFactory, seed, delays, perceptionLog) {
    // Separate generators: only the reaction-delay one is logged, so the
    // realized variance check measures N(200, 40) and nothing else.
    const gaussReaction = makeGaussian(makeRng(seed * 2654435761), delays)
    const gaussMotor = makeGaussian(makeRng(seed * 40503 + 7), null)
    const gaussPerception = makeGaussian(makeRng(seed * 22695477 + 11), perceptionLog)

    const state = createRun(String(seed))
    const policy = policyFactory(gaussReaction, gaussMotor)
    tap(state) // the first tap unfreezes the recoil, exactly as a player's does

    let pendingAtTick = null
    let tick = 0
    while (!state.over && tick < MAX_TICKS) {
        const view = observe(state, gaussPerception)
        if (pendingAtTick !== null && tick >= pendingAtTick) {
            tap(state)
            pendingAtTick = null
        }
        // The player keeps watching the screen while a strike is in flight, so
        // the policy observes every tick and only acts when its hand is free.
        const canAct = pendingAtTick === null && !view.resolving
        const delayMs = policy.decide(view, tick, canAct)
        if (canAct && delayMs !== null) pendingAtTick = tick + Math.round(delayMs / STEP_MS)
        step(state)
        tick += 1
    }
    const s = summarize(state)
    // Observed play distribution: the tier each tap actually landed in, and the
    // timing error normalized by the success window the player could see.
    const tiers = { miss: 0, bite: 0, precise: 0, grain: 0 }
    const normalized = []
    for (const t of state.taps) {
        tiers[t.tier] += 1
        normalized.push(1 - t.accuracy)
    }
    return { ...s, timedOut: !state.over, tickCount: tick, tiers, normalized }
}

function stats(values) {
    if (values.length === 0) return { n: 0, mean: 0, sd: 0 }
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
    return { n: values.length, mean, sd }
}

function quantile(sorted, q) {
    if (sorted.length === 0) return 0
    const i = (sorted.length - 1) * q
    const lo = Math.floor(i), hi = Math.ceil(i)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

function summarizePolicy(name, results, delays) {
    const scores = results.map((r) => r.score).sort((a, b) => a - b)
    const splits = results.map((r) => r.splits)
    const acc = results.map((r) => r.avgAccuracy)
    const completed = results.filter((r) => r.endReason === 'complete').length
    const wedgesGone = results.filter((r) => r.endReason === 'wedgesGone').length
    const timedOut = results.filter((r) => r.timedOut).length
    const noFailure = results.filter((r) => r.failures === 0).length
    const seconds = results.map((r) => r.elapsedMs / 1000)
    const precise = results.map((r) => r.preciseCount)
    const grain = results.map((r) => r.grainSplits)
    const totalTaps = results.reduce((a, r) => a + r.taps, 0)
    const totalPrecise = results.reduce((a, r) => a + r.preciseCount, 0)
    const d = stats(delays)
    const tiers = { miss: 0, bite: 0, precise: 0, grain: 0 }
    let normalized = []
    for (const r of results) {
        for (const k of Object.keys(tiers)) tiers[k] += r.tiers[k]
        normalized = normalized.concat(r.normalized)
    }
    const tapTotal = Object.values(tiers).reduce((a, b) => a + b, 0)
    normalized.sort((a, b) => a - b)
    return {
        policy: name,
        runs: results.length,
        completionRate: completed / results.length,
        wedgesGoneRate: wedgesGone / results.length,
        timeoutRate: timedOut / results.length,
        zeroFailureRate: noFailure / results.length,
        splits: stats(splits),
        avgAccuracy: stats(acc),
        preciseTapsPerRun: stats(precise),
        precisionRateOfAllTaps: totalTaps ? totalPrecise / totalTaps : 0,
        grainSplitsPerRun: stats(grain),
        seconds: stats(seconds),
        scoreMedian: quantile(scores, 0.5),
        scoreP10: quantile(scores, 0.1),
        scoreP90: quantile(scores, 0.9),
        observedTierShare: {
            miss: tiers.miss / tapTotal,
            bite: tiers.bite / tapTotal,
            precise: tiers.precise / tapTotal,
            grain: tiers.grain / tapTotal,
            preciseOrBetter: (tiers.precise + tiers.grain) / tapTotal,
        },
        // |error| / success window, as seen in play. The design intent is that
        // 정타 sits around the top 35% and 결 around the top 8% of this.
        observedNormalizedError: {
            p08: quantile(normalized, 0.08),
            p35: quantile(normalized, 0.35),
            p50: quantile(normalized, 0.5),
            p90: quantile(normalized, 0.9),
        },
        reactionDelay: { specifiedMean: REACTION_MU, specifiedSd: REACTION_SIGMA, realizedMean: d.mean, realizedSd: d.sd, samples: d.n },
    }
}

// ------------------------------------------------------------- main

const RUNS = Number(process.argv[2] || 600)

const policies = [
    ['intuitive', intuitivePolicy],
    ['skilled', skilledPolicy],
]

const report = { runsPerPolicy: RUNS, totalLogs: TOTAL_LOGS, failureBudget: FAILURE_BUDGET, stepMs: STEP_MS, policies: [] }
for (const [name, factory] of policies) {
    const delays = []
    const perception = []
    const results = []
    for (let i = 0; i < RUNS; i++) results.push(runOnce(factory, i + 1, delays, perception))
    report.policies.push(summarizePolicy(name, results, delays))
}

const [intuitive, skilled] = report.policies
// Combined observed distribution across both human models, which is what the
// 정타/결 thresholds are supposed to be calibrated against.
{
    const all = report.policies
    const totals = { miss: 0, bite: 0, precise: 0, grain: 0 }
    let taps = 0
    for (const p of all) {
        for (const k of Object.keys(totals)) totals[k] += p.observedTierShare[k] * p.runs
        taps += p.runs
    }
    report.observedCombinedTierShare = {
        preciseOrBetter: (totals.precise + totals.grain) / taps,
        grain: totals.grain / taps,
    }
}

report.gates = {
    intuitiveEndsOnAJudgment: intuitive.timeoutRate === 0,
    intuitiveNotSaturated: !(intuitive.completionRate >= 1 && intuitive.zeroFailureRate >= 1),
    intuitiveSeesTheCoreJudgment: intuitive.splits.mean >= 2,
    skilledCanFinish: skilled.completionRate > 0.2,
    skilledTensionRemains: skilled.precisionRateOfAllTaps < 0.95 && skilled.completionRate < 1,
    scoresSeparate: skilled.scoreMedian > intuitive.scoreMedian,
    withinSessionCap: Math.max(intuitive.seconds.mean, skilled.seconds.mean) < 180,
}
report.pass = Object.values(report.gates).every(Boolean)

console.log(JSON.stringify(report, null, 2))
rmSync(outDir, { recursive: true, force: true })
if (!report.pass) {
    console.error('FAIL: playability gate not met')
    process.exit(1)
}
console.error('PLAYABILITY OK')
