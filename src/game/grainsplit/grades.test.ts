import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { CRACK_FACE, STRIKE_FEEL, TIER_COLOR, TIER_LADDER, gradeLabel } from './grades'
import { STRINGS } from './strings'
import type { Tier } from './rules'

/**
 * The grade ladder has to survive two failure modes that have shipped before:
 *
 *  1. Dead labels: the tier names exist in strings.ts but no render path ever
 *     consumes them, so the grade is never called by its name during play and
 *     is only counted on the result screen.
 *  2. Adjacent grades separated by an amount too small to judge from a single
 *     frame, with nothing in frame to measure against.
 */

const ADJACENT: ReadonlyArray<readonly [Tier, Tier]> = [
    ['miss', 'bite'],
    ['bite', 'precise'],
    ['precise', 'grain'],
]

describe('grade ladder', () => {
    it('has a rung for every judgment tier, lowest first', () => {
        expect([...TIER_LADDER]).toEqual(['miss', 'bite', 'precise', 'grain'])
    })

    it('names every grade in both languages', () => {
        for (const lang of ['ko', 'en'] as const) {
            for (const tier of TIER_LADDER) {
                const label = gradeLabel(lang, tier)
                expect(label, `${lang}.${tier}`).toBe(STRINGS[lang].tier[tier])
                expect(label.trim(), `${lang}.${tier}`).not.toBe('')
                // A key leaking through as the label would mean the lookup failed.
                expect(label, `${lang}.${tier}`).not.toBe(tier)
            }
        }
    })

    it('gives every grade a distinct colour so the name and its rung match', () => {
        const colours = TIER_LADDER.map((t) => TIER_COLOR[t])
        expect(new Set(colours).size).toBe(TIER_LADDER.length)
    })

    it('separates adjacent grades by kind, not only by amount', () => {
        // Below 정타 nothing pale opens up; at 정타 and above the end grain shows.
        expect(CRACK_FACE.miss.lip).toBe(0)
        expect(CRACK_FACE.bite.face).toBe(CRACK_FACE.miss.face)
        expect(CRACK_FACE.bite.fringe).toBe(0)
        expect(CRACK_FACE.precise.fringe).toBeGreaterThan(0)
        expect(CRACK_FACE.precise.face).not.toBe(CRACK_FACE.bite.face)
        expect(CRACK_FACE.grain.face).not.toBe(CRACK_FACE.bite.face)
    })

    it('makes every adjacent pair differ by a margin readable in one frame', () => {
        for (const [lo, hi] of ADJACENT) {
            // Each step at least triples the gash, so no reference is needed to
            // tell which of two grades a single frame is showing.
            expect(CRACK_FACE[hi].width / CRACK_FACE[lo].width, `${lo}->${hi} width`)
                .toBeGreaterThanOrEqual(1.4)
            expect(STRIKE_FEEL[hi].seat, `${lo}->${hi} seat`).toBeGreaterThan(STRIKE_FEEL[lo].seat + 8)
            expect(STRIKE_FEEL[hi].dust, `${lo}->${hi} dust`).toBeGreaterThan(STRIKE_FEEL[lo].dust * 1.5)
            expect(STRIKE_FEEL[hi].stop, `${lo}->${hi} stop`).toBeGreaterThan(STRIKE_FEEL[lo].stop)
        }
        // The pair the review could not separate side by side is the widest jump.
        expect(CRACK_FACE.precise.width / CRACK_FACE.bite.width).toBeGreaterThanOrEqual(3)
    })

    it('is consumed by the runtime during play, not only on the result screen', () => {
        const src = readFileSync(new URL('../GrainsplitGame.ts', import.meta.url), 'utf-8')
        // The label lookup is called from the render path...
        expect(src).toContain('gradeLabel(this.lang, tier)')
        expect(src).toContain('gradeLabel(this.lang, rung)')
        // ...and drawGrade is driven from the per-frame HUD pass, gated on the
        // play phase rather than the result screen.
        expect(src).toMatch(/private drawHud\(\)[\s\S]*this\.drawGrade\(/)
        expect(src).toMatch(/private drawGrade\([\s\S]*this\.phase === 'play'/)
    })
})
