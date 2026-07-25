/**
 * Difficulty bands — the locked design table from GDD.md.
 *
 * Every column here must be perceptible on screen (see GDD "난이도 밴드").
 * Changing a number here changes the game; update GDD.md and the tests in the
 * same edit.
 */

export interface Band {
    /** 1..5 */
    index: number
    /** Recoil period in milliseconds. */
    recoilPeriodMs: number
    /** Per-cycle period jitter as a fraction (0 = fixed period). */
    jitter: number
    /** Half-width of the success window in milliseconds. */
    successWindowMs: number
    /** Half-width of the precision (정타) window in milliseconds. */
    precisionWindowMs: number
    /** Half-width of the grain (결) window in milliseconds. */
    grainWindowMs: number
    /** Painted target band width, as a fraction of log length. */
    bandWidth: number
    /** Grain bias — how hard the fibre field bends the crack per tap, in radians. */
    grainBias: number
    /** Inclusive knot count range. */
    knotsMin: number
    knotsMax: number
    /** Taps the log is designed to take at full advance. */
    plannedTaps: number
}

export const BANDS: readonly Band[] = [
    { index: 1, recoilPeriodMs: 1100, jitter: 0,    successWindowMs: 140, precisionWindowMs: 45, grainWindowMs: 16, bandWidth: 0.180, grainBias: 0.05, knotsMin: 0, knotsMax: 0, plannedTaps: 3 },
    { index: 2, recoilPeriodMs: 950,  jitter: 0,    successWindowMs: 115, precisionWindowMs: 36, grainWindowMs: 13, bandWidth: 0.140, grainBias: 0.12, knotsMin: 1, knotsMax: 1, plannedTaps: 4 },
    { index: 3, recoilPeriodMs: 820,  jitter: 0,    successWindowMs: 92,  precisionWindowMs: 28, grainWindowMs: 11, bandWidth: 0.110, grainBias: 0.20, knotsMin: 1, knotsMax: 2, plannedTaps: 4 },
    { index: 4, recoilPeriodMs: 700,  jitter: 0,    successWindowMs: 72,  precisionWindowMs: 22, grainWindowMs: 9,  bandWidth: 0.085, grainBias: 0.30, knotsMin: 2, knotsMax: 2, plannedTaps: 5 },
    { index: 5, recoilPeriodMs: 600,  jitter: 0.08, successWindowMs: 56,  precisionWindowMs: 16, grainWindowMs: 7,  bandWidth: 0.065, grainBias: 0.40, knotsMin: 2, knotsMax: 3, plannedTaps: 6 },
]

/** Logs in one run. */
export const TOTAL_LOGS = 14

/** Wedges standing beside the cradle. One snaps per failed log. */
export const FAILURE_BUDGET = 3

/** Log index (1-based) to band index (1-based). 3/3/3/3/2. */
export function bandIndexForLog(logIndex: number): number {
    if (logIndex <= 3) return 1
    if (logIndex <= 6) return 2
    if (logIndex <= 9) return 3
    if (logIndex <= 12) return 4
    return 5
}

export function bandForLog(logIndex: number): Band {
    return BANDS[bandIndexForLog(logIndex) - 1]
}
