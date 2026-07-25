import { describe, it, expect } from 'vitest'
import {
    createRun, step, tap, summarize, currentErrorMs, ringOpen, recoilHeight,
    bandNear, bandFar, STEP_MS, TOTAL_LOGS, FAILURE_BUDGET, TAP_LOCKOUT_MS,
    type RunState,
} from './engine'

/**
 * Wait for the recoil peak and tap `offsetMs` off it. Negative = early.
 * Only ever reads what the screen shows (the ring / the wedge height) and only
 * advances time with the real fixed step.
 */
function tapAt(state: RunState, offsetMs: number, maxTicks = 4000): ReturnType<typeof tap> {
    // First get clearly into the waiting half of the cycle.
    for (let i = 0; i < maxTicks && !state.over; i++) {
        if (currentErrorMs(state.log) < -state.log.currentPeriodMs * 0.25) break
        step(state)
    }
    for (let i = 0; i < maxTicks && !state.over; i++) {
        if (currentErrorMs(state.log) >= offsetMs) return tap(state)
        step(state)
    }
    return null
}

function startRun(seed = 'test'): RunState {
    const state = createRun(seed)
    tap(state) // first tap only unfreezes the recoil
    return state
}

describe('freeze before the first tap', () => {
    it('does not advance time or recoil until the first tap', () => {
        const state = createRun('freeze')
        const phase = state.log.phaseMs
        for (let i = 0; i < 600; i++) step(state)
        expect(state.elapsedMs).toBe(0)
        expect(state.ticks).toBe(0)
        expect(state.log.phaseMs).toBe(phase)
        expect(state.started).toBe(false)
        expect(state.guideVisible).toBe(true)
    })

    it('starts on the first tap without spending a tap', () => {
        const state = createRun('freeze')
        expect(tap(state)).toBeNull()
        expect(state.started).toBe(true)
        expect(state.log.tapsUsed).toBe(0)
        expect(state.taps).toHaveLength(0)
        step(state)
        expect(state.elapsedMs).toBeCloseTo(STEP_MS)
    })
})

describe('clock', () => {
    it('is only accumulated ticks x STEP_MS', () => {
        const state = startRun()
        for (let i = 0; i < 120; i++) step(state)
        expect(state.ticks).toBe(120)
        expect(state.elapsedMs).toBeCloseTo(120 * STEP_MS, 9)
    })
})

describe('determinism', () => {
    it('replays identically for the same seed and tap schedule', () => {
        const play = (seed: string) => {
            const state = startRun(seed)
            const offsets = [0, 30, -20, 55, -70, 10, 90, -40]
            let i = 0
            while (!state.over && state.ticks < 60 * 300) {
                tapAt(state, offsets[i++ % offsets.length])
                if (state.log.outcome) for (let k = 0; k < 100 && state.log.outcome; k++) step(state)
            }
            return summarize(state)
        }
        expect(play('seed-a')).toEqual(play('seed-a'))
    })

    it('produces different logs for different seeds', () => {
        const a = createRun('alpha')
        const b = createRun('beta')
        expect(a.log.bandCenter).not.toBeCloseTo(b.log.bandCenter, 6)
    })
})

describe('recoil and ring', () => {
    it('opens the ring exactly inside the success window', () => {
        const state = startRun()
        const band = state.log.band
        let sawOpen = false
        let sawClosed = false
        for (let i = 0; i < 400; i++) {
            const err = Math.abs(currentErrorMs(state.log))
            expect(ringOpen(state.log)).toBe(err <= band.successWindowMs)
            if (ringOpen(state.log)) sawOpen = true
            else sawClosed = true
            step(state)
        }
        expect(sawOpen && sawClosed).toBe(true)
    })

    it('rides the wedge to its peak exactly when the error is zero', () => {
        const state = startRun()
        let best = { err: Infinity, height: 0 }
        for (let i = 0; i < 200; i++) {
            const err = Math.abs(currentErrorMs(state.log))
            if (err < best.err) best = { err, height: recoilHeight(state.log) }
            step(state)
        }
        expect(best.height).toBeGreaterThan(0.99)
    })
})

describe('the wedge strike', () => {
    it('advances the crack on a good tap and not at all on a miss', () => {
        const state = startRun()
        const hit = tapAt(state, 0)
        expect(hit?.tier === 'precise' || hit?.tier === 'grain').toBe(true)
        expect(state.log.crackP).toBeGreaterThan(0)

        const before = state.log.crackP
        const missOffset = state.log.band.successWindowMs + 60
        const miss = tapAt(state, missOffset)
        expect(miss?.tier).toBe('miss')
        expect(miss?.multiplier).toBe(0)
        expect(state.log.crackP).toBe(before)
        expect(state.log.tapsUsed).toBe(2) // a miss still burns the budget
    })

    it('ignores taps during the wedge re-cock lockout', () => {
        const state = startRun()
        tapAt(state, 0)
        expect(state.log.lockoutMs).toBe(TAP_LOCKOUT_MS)
        const used = state.log.tapsUsed
        expect(tap(state)).toBeNull()
        expect(state.log.tapsUsed).toBe(used)
    })

    it('splits the log in the planned number of taps at full advance', () => {
        const state = startRun('planned')
        const planned = state.log.band.plannedTaps
        for (let i = 0; i < planned; i++) tapAt(state, 0)
        expect(state.log.outcome).toBe('split')
        expect(state.log.tapsUsed).toBe(planned)
    })

    it('leaves a sticky correction cue with direction and magnitude', () => {
        const state = startRun()
        tapAt(state, 40)
        expect(state.log.lastTap).not.toBeNull()
        expect(state.log.lastTap!.errorMs).toBeGreaterThan(0) // 늦음
        const kept = state.log.lastTap
        for (let i = 0; i < 60; i++) step(state)
        expect(state.log.lastTap).toBe(kept) // persists until the log is done
    })
})

describe('log outcomes', () => {
    it('shatters when the crack runs past the band', () => {
        const state = startRun('shatter')
        // Full-strength taps every time overshoot once the tip is already in reach.
        for (let i = 0; i < 20 && !state.log.outcome; i++) tapAt(state, 0)
        expect(state.log.outcome).not.toBeNull()
    })

    it('records short when the tap budget runs out before the band', () => {
        const state = startRun('short')
        const budget = state.log.tapBudget
        const missOffset = state.log.band.successWindowMs + 80
        for (let i = 0; i < budget; i++) tapAt(state, missOffset)
        expect(state.log.outcome).toBe('short')
        expect(state.log.crackP).toBe(0)
        expect(state.failures).toBe(1)
        expect(state.lastFailure?.outcome).toBe('short')
        expect(state.lastFailure!.delta).toBeGreaterThan(0)
    })

    it('keeps every piece on the woodpile, split and ruined alike', () => {
        const state = startRun('pile')
        while (!state.over && state.ticks < 60 * 300) {
            tapAt(state, 0)
            for (let k = 0; k < 120 && state.log.outcome; k++) step(state)
        }
        expect(state.pile.length).toBeGreaterThan(0)
        expect(state.pile.length).toBe(state.splits + state.failures)
    })
})

describe('grain (결) firing condition', () => {
    it('needs both the grain window and the tap that parks the tip in the band', () => {
        const state = startRun('grain')
        const planned = state.log.band.plannedTaps
        for (let i = 0; i < planned - 1; i++) {
            const r = tapAt(state, 0)
            // dead-centre taps before the last one are 정타, never 결
            expect(r?.tier).toBe('precise')
        }
        const last = tapAt(state, 0)
        expect(last?.outcome).toBe('split')
        expect(last?.tier).toBe('grain')
        expect(state.grainSplits).toBe(1)
    })

    it('does not fire 결 on a landing tap outside the grain window', () => {
        const state = startRun('grain2')
        const band = state.log.band
        const wide = (band.grainWindowMs + band.precisionWindowMs) / 2
        expect(wide).toBeGreaterThan(band.grainWindowMs)
        const planned = band.plannedTaps
        for (let i = 0; i < planned - 1; i++) tapAt(state, 0)
        const last = tapAt(state, wide)
        expect(last?.tier).toBe('precise')
        expect(state.grainSplits).toBe(0)
    })
})

describe('failure budget', () => {
    it('ends the run when the third wedge snaps', () => {
        const state = startRun('budget')
        let guard = 0
        while (!state.over && guard++ < 200) {
            const missOffset = state.log.band.successWindowMs + 80
            for (let i = 0; i < state.log.tapBudget && !state.log.outcome; i++) tapAt(state, missOffset)
            for (let k = 0; k < 120 && state.log.outcome; k++) step(state)
        }
        expect(state.over).toBe(true)
        expect(state.endReason).toBe('wedgesGone')
        expect(state.failures).toBe(FAILURE_BUDGET)
        expect(state.splits).toBe(0)
        expect(summarize(state).score).toBeLessThan(1_000_000)
    })
})

describe('guide exposure', () => {
    it('stays up for two successes, then returns after two straight failures', () => {
        const state = startRun('guide')
        expect(state.guideVisible).toBe(true)

        const finish = (offset: number) => {
            for (let i = 0; i < state.log.tapBudget && !state.log.outcome; i++) tapAt(state, offset)
            for (let k = 0; k < 120 && state.log.outcome; k++) step(state)
        }

        finish(0)
        expect(state.splits).toBe(1)
        expect(state.guideVisible).toBe(true) // one success is not enough

        finish(0)
        expect(state.splits).toBe(2)
        expect(state.guideVisible).toBe(false)

        const missFor = () => state.log.band.successWindowMs + 80
        finish(missFor())
        expect(state.guideVisible).toBe(false) // one failure is not enough
        finish(missFor())
        expect(state.guideVisible).toBe(true)
    })
})

describe('a whole run', () => {
    it('finishes 14 logs and fits the declared session budget', () => {
        const state = startRun('full')
        let guard = 0
        while (!state.over && guard++ < 400) {
            tapAt(state, 0)
            for (let k = 0; k < 120 && state.log.outcome; k++) step(state)
        }
        const s = summarize(state)
        expect(state.over).toBe(true)
        expect(s.endReason).toBe('complete')
        expect(s.splits).toBe(TOTAL_LOGS)
        expect(Math.floor(s.score / 1_000_000)).toBe(14)
        expect(s.score % 1000).toBe(Math.min(999, s.preciseCount))
        // Even dead-centre play cannot saturate accuracy: the fixed 1/60s step
        // quantizes the error, so the ceiling sits below 1.0 and there is
        // always somewhere left to climb.
        expect(s.avgAccuracy).toBeGreaterThan(0.85)
        expect(s.avgAccuracy).toBeLessThan(1)
        // game.manifest.json declares maxSeconds 180.
        expect(s.elapsedMs).toBeLessThan(180_000)
        expect(s.elapsedMs).toBeGreaterThan(40_000)
    })

    it('reports the swing, and never leans on the signed mean', () => {
        const state = startRun('swing')
        let guard = 0
        let sign = 1
        while (!state.over && guard++ < 400) {
            tapAt(state, sign * state.log.band.successWindowMs * 0.55)
            sign = -sign
            for (let k = 0; k < 120 && state.log.outcome; k++) step(state)
        }
        const s = summarize(state)
        expect(Math.abs(s.signedMeanErrorMs)).toBeLessThan(s.swingMs)
        expect(s.swingMs).toBeGreaterThan(20)
        expect(s.meanAbsErrorMs).toBeGreaterThan(20)
    })

    it('separates a sloppy run from a clean one in score', () => {
        const run = (offsetOf: (s: RunState) => number) => {
            const state = startRun('compare')
            let guard = 0
            while (!state.over && guard++ < 400) {
                tapAt(state, offsetOf(state))
                for (let k = 0; k < 120 && state.log.outcome; k++) step(state)
            }
            return summarize(state)
        }
        const clean = run(() => 0)
        const sloppy = run((s) => s.log.band.successWindowMs * 0.8)
        expect(clean.score).toBeGreaterThan(sloppy.score)
        expect(clean.avgAccuracy).toBeGreaterThan(sloppy.avgAccuracy)
    })
})

describe('band geometry', () => {
    it('paints a band that is reachable and narrows per band', () => {
        const widths: number[] = []
        for (const seed of ['a', 'b', 'c']) {
            const state = createRun(seed)
            expect(bandNear(state.log)).toBeGreaterThan(0)
            expect(bandFar(state.log)).toBeLessThan(1)
            expect(bandFar(state.log) - bandNear(state.log)).toBeCloseTo(state.log.band.bandWidth, 9)
            widths.push(state.log.bandWidth)
        }
        expect(new Set(widths).size).toBe(1) // band 1 for every seed's first log
    })

    it('sets base advance so planned taps land dead centre', () => {
        const state = createRun('geom')
        const log = state.log
        expect(log.baseAdvance * log.band.plannedTaps).toBeCloseTo(log.bandCenter, 9)
    })
})
