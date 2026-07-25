import { describe, it, expect } from 'vitest'
import { BANDS, TOTAL_LOGS, FAILURE_BUDGET, bandForLog, bandIndexForLog } from './bands'
import {
    STEP_MS, signedPhaseErrorMs, timingTier, advanceMultiplier, tapAccuracy,
    encodeScore, standardDeviation, fibreAt, clampAngle, MAX_ANGLE,
} from './rules'

describe('depth table', () => {
    it('covers 14 logs in 5 bands', () => {
        expect(BANDS).toHaveLength(5)
        expect(TOTAL_LOGS).toBe(14)
        expect(FAILURE_BUDGET).toBe(3)
        const counts = [0, 0, 0, 0, 0]
        for (let i = 1; i <= TOTAL_LOGS; i++) counts[bandIndexForLog(i) - 1] += 1
        expect(counts).toEqual([3, 3, 3, 3, 2])
    })

    it('matches the locked design numbers', () => {
        expect(BANDS.map((b) => b.recoilPeriodMs)).toEqual([1100, 950, 820, 700, 600])
        expect(BANDS.map((b) => b.successWindowMs)).toEqual([140, 115, 92, 72, 56])
        expect(BANDS.map((b) => b.precisionWindowMs)).toEqual([45, 36, 28, 22, 16])
        expect(BANDS.map((b) => b.grainWindowMs)).toEqual([16, 13, 11, 9, 7])
        expect(BANDS.map((b) => b.bandWidth)).toEqual([0.18, 0.14, 0.11, 0.085, 0.065])
        expect(BANDS.map((b) => b.grainBias)).toEqual([0.05, 0.12, 0.2, 0.3, 0.4])
        expect(BANDS[4].jitter).toBeCloseTo(0.08)
    })

    it('tightens every difficulty variable monotonically', () => {
        for (let i = 1; i < BANDS.length; i++) {
            const prev = BANDS[i - 1]
            const cur = BANDS[i]
            expect(cur.recoilPeriodMs).toBeLessThan(prev.recoilPeriodMs)
            expect(cur.successWindowMs).toBeLessThan(prev.successWindowMs)
            expect(cur.precisionWindowMs).toBeLessThan(prev.precisionWindowMs)
            expect(cur.grainWindowMs).toBeLessThan(prev.grainWindowMs)
            expect(cur.bandWidth).toBeLessThan(prev.bandWidth)
            expect(cur.grainBias).toBeGreaterThan(prev.grainBias)
            expect(cur.knotsMax).toBeGreaterThanOrEqual(prev.knotsMax)
        }
    })

    it('orders the three judgment windows inside every band', () => {
        for (const b of BANDS) {
            expect(b.grainWindowMs).toBeLessThan(b.precisionWindowMs)
            expect(b.precisionWindowMs).toBeLessThan(b.successWindowMs)
            expect(b.successWindowMs * 2).toBeLessThan(b.recoilPeriodMs)
        }
    })

    it('maps log index to band', () => {
        expect(bandForLog(1).index).toBe(1)
        expect(bandForLog(3).index).toBe(1)
        expect(bandForLog(4).index).toBe(2)
        expect(bandForLog(9).index).toBe(3)
        expect(bandForLog(10).index).toBe(4)
        expect(bandForLog(14).index).toBe(5)
    })
})

describe('phase error', () => {
    it('is zero at the recoil peak', () => {
        expect(signedPhaseErrorMs(0, 1000)).toBe(0)
    })

    it('is positive just after the peak (늦음) and negative just before (빠름)', () => {
        expect(signedPhaseErrorMs(40, 1000)).toBe(40)
        expect(signedPhaseErrorMs(960, 1000)).toBe(-40)
    })

    it('never exceeds half a period', () => {
        for (let p = 0; p < 1000; p += 7) {
            expect(Math.abs(signedPhaseErrorMs(p, 1000))).toBeLessThanOrEqual(500)
        }
    })

    it('wraps over many cycles', () => {
        expect(signedPhaseErrorMs(7000 + 30, 1000)).toBeCloseTo(30)
    })

    it('uses a fixed 1/60s step', () => {
        expect(STEP_MS).toBeCloseTo(16.6667, 3)
    })
})

describe('tiers', () => {
    const b = BANDS[0] // ±140 / ±45 / ±16

    it('splits into four tiers on one input', () => {
        expect(timingTier(200, b)).toBe('miss')
        expect(timingTier(100, b)).toBe('bite')
        expect(timingTier(30, b)).toBe('precise')
        expect(timingTier(10, b)).toBe('grain')
    })

    it('puts window edges inside the better tier', () => {
        expect(timingTier(b.successWindowMs, b)).toBe('bite')
        expect(timingTier(b.successWindowMs + 0.001, b)).toBe('miss')
        expect(timingTier(b.precisionWindowMs, b)).toBe('precise')
        expect(timingTier(b.grainWindowMs, b)).toBe('grain')
    })
})

describe('advance multiplier', () => {
    const b = BANDS[0]

    it('bounces the wedge outside the success window', () => {
        expect(advanceMultiplier(141, b)).toBe(0)
    })

    it('is exactly 1.0 anywhere inside the precision window', () => {
        expect(advanceMultiplier(0, b)).toBe(1)
        expect(advanceMultiplier(45, b)).toBe(1)
    })

    it('falls to 0.6 at the edge of the success window', () => {
        expect(advanceMultiplier(140, b)).toBeCloseTo(0.6, 6)
    })

    it('is continuous and monotone across the bite range', () => {
        let prev = 1.0001
        for (let e = 45; e <= 140; e += 1) {
            const m = advanceMultiplier(e, b)
            expect(m).toBeLessThanOrEqual(prev + 1e-9)
            expect(m).toBeGreaterThanOrEqual(0.6 - 1e-9)
            prev = m
        }
    })
})

describe('accuracy', () => {
    const b = BANDS[0]

    it('is 1 at the peak and 0 at the window edge', () => {
        expect(tapAccuracy(0, b)).toBe(1)
        expect(tapAccuracy(140, b)).toBe(0)
        expect(tapAccuracy(500, b)).toBe(0)
    })

    it('is normalized per band, not in absolute milliseconds', () => {
        // The same 0.5-of-window error scores the same in every band.
        for (const band of BANDS) {
            expect(tapAccuracy(band.successWindowMs / 2, band)).toBeCloseTo(0.5, 9)
        }
    })
})

describe('score encoding', () => {
    it('is lexicographic: no lower tier can reach one unit of a higher tier', () => {
        const maxLower = encodeScore({ splits: 0, avgAccuracy: 1, preciseCount: 999 })
        expect(maxLower).toBe(999_999)
        expect(maxLower).toBeLessThan(encodeScore({ splits: 1, avgAccuracy: 0, preciseCount: 0 }))

        // and one rung up, inside the accuracy tier
        const maxPrecise = encodeScore({ splits: 0, avgAccuracy: 0, preciseCount: 999 })
        expect(maxPrecise).toBe(999)
        expect(maxPrecise).toBeLessThan(encodeScore({ splits: 0, avgAccuracy: 1 / 999, preciseCount: 0 }))
    })

    it('holds for every adjacent split count', () => {
        for (let s = 0; s < 14; s++) {
            const best = encodeScore({ splits: s, avgAccuracy: 1, preciseCount: 999 })
            const worst = encodeScore({ splits: s + 1, avgAccuracy: 0, preciseCount: 0 })
            expect(best).toBeLessThan(worst)
        }
    })

    it('caps and clamps its inputs', () => {
        expect(encodeScore({ splits: 99, avgAccuracy: 5, preciseCount: 5000 })).toBe(14_999_999)
        expect(encodeScore({ splits: -3, avgAccuracy: -1, preciseCount: -7 })).toBe(0)
    })

    it('reaches its maximum on a flawless run', () => {
        expect(encodeScore({ splits: 14, avgAccuracy: 1, preciseCount: 60 })).toBe(14_999_060)
    })
})

describe('swing readout', () => {
    it('does not summarize a two-sided swing as near perfect', () => {
        const swinging = [-120, 118, -115, 121, -119, 117]
        const signedMean = swinging.reduce((a, b) => a + b, 0) / swinging.length
        expect(Math.abs(signedMean)).toBeLessThan(3) // the trap a signed mean falls into
        expect(standardDeviation(swinging)).toBeGreaterThan(100) // what we show instead
    })

    it('is zero for a constant error', () => {
        expect(standardDeviation([40, 40, 40])).toBe(0)
        expect(standardDeviation([])).toBe(0)
    })
})

describe('fibre field', () => {
    it('is bounded by its control nodes and smooth', () => {
        const nodes = [-1, 0.5, -0.25, 1, 0, -0.75]
        for (let p = 0; p <= 1; p += 0.01) {
            const v = fibreAt(nodes, p)
            expect(v).toBeGreaterThanOrEqual(-1.0001)
            expect(v).toBeLessThanOrEqual(1.0001)
        }
        expect(fibreAt(nodes, 0)).toBeCloseTo(-1)
        expect(fibreAt(nodes, 1)).toBeCloseTo(-0.75)
    })

    it('is deterministic', () => {
        const nodes = [0.3, -0.7, 0.1, 0.9, -0.2, 0.4]
        expect(fibreAt(nodes, 0.37)).toBe(fibreAt(nodes, 0.37))
    })
})

describe('angle clamp', () => {
    it('keeps the crack inside the log', () => {
        expect(clampAngle(9)).toBe(MAX_ANGLE)
        expect(clampAngle(-9)).toBe(-MAX_ANGLE)
        expect(clampAngle(0.1)).toBe(0.1)
    })
})
