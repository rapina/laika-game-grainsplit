/**
 * Pure judgment functions. No state, no randomness, no rendering.
 * The runtime, the tests and scripts/playability-sim.mjs all go through these.
 */

import type { Band } from './bands'

/** Fixed simulation step. Render frames are decoupled from this. */
export const STEP_MS = 1000 / 60

export type Tier = 'miss' | 'bite' | 'precise' | 'grain'

/** Maximum crack heading, radians. Beyond this the crack would leave the log. */
export const MAX_ANGLE = 0.6

/**
 * Signed error against the nearest recoil peak (peak is phase 0).
 * Negative = tapped early (빠름), positive = tapped late (늦음).
 */
export function signedPhaseErrorMs(phaseMs: number, periodMs: number): number {
    if (periodMs <= 0) return 0
    let p = phaseMs % periodMs
    if (p < 0) p += periodMs
    return p > periodMs / 2 ? p - periodMs : p
}

/**
 * Timing tier from the error magnitude alone. 'grain' here means "inside the
 * 결 window"; whether it actually fires as 결 also needs the tap to be the one
 * that parks the crack inside the band (see engine.tap).
 */
export function timingTier(absErrorMs: number, band: Band): Tier {
    if (absErrorMs > band.successWindowMs) return 'miss'
    if (absErrorMs <= band.grainWindowMs) return 'grain'
    if (absErrorMs <= band.precisionWindowMs) return 'precise'
    return 'bite'
}

/**
 * Crack advance multiplier. 1.0 inside the precision window, falling linearly
 * to 0.6 at the edge of the success window, 0 outside it (the wedge bounces).
 */
export function advanceMultiplier(absErrorMs: number, band: Band): number {
    if (absErrorMs > band.successWindowMs) return 0
    if (absErrorMs <= band.precisionWindowMs) return 1
    const span = band.successWindowMs - band.precisionWindowMs
    if (span <= 0) return 1
    const t = (absErrorMs - band.precisionWindowMs) / span
    return 1 - 0.4 * t
}

/** Per-tap accuracy in 0..1: 1 at the peak, 0 at or outside the success window. */
export function tapAccuracy(absErrorMs: number, band: Band): number {
    const n = absErrorMs / band.successWindowMs
    return n >= 1 ? 0 : 1 - n
}

export function clampAngle(angle: number): number {
    return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle))
}

/** Population standard deviation. Used for the swing readout, never a signed mean. */
export function standardDeviation(values: readonly number[]): number {
    if (values.length === 0) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length
    return Math.sqrt(variance)
}

export function mean(values: readonly number[]): number {
    if (values.length === 0) return 0
    return values.reduce((a, b) => a + b, 0) / values.length
}

export interface ScoreParts {
    /** Logs split cleanly, 0..14. */
    splits: number
    /** Average per-tap accuracy, 0..1. */
    avgAccuracy: number
    /** 정타 + 결 count. Saturates at 999. */
    preciseCount: number
}

/**
 * Lexicographic score. Each tier is strictly dominant over everything below it:
 * one more split always beats any accuracy/precision combination.
 */
export function encodeScore(parts: ScoreParts): number {
    const splits = Math.max(0, Math.min(14, Math.floor(parts.splits)))
    const acc = Math.round(Math.max(0, Math.min(1, parts.avgAccuracy)) * 999)
    const precise = Math.max(0, Math.min(999, Math.floor(parts.preciseCount)))
    return splits * 1_000_000 + acc * 1_000 + precise
}

/** Smooth seeded fibre field across the log, in -1..1. Drawn on screen as bent fibre lines. */
export function fibreAt(nodes: readonly number[], p: number): number {
    if (nodes.length === 0) return 0
    const x = Math.max(0, Math.min(1, p)) * (nodes.length - 1)
    const i = Math.min(nodes.length - 2, Math.floor(x))
    const f = x - i
    const smooth = f * f * (3 - 2 * f)
    return nodes[i] * (1 - smooth) + nodes[i + 1] * smooth
}
