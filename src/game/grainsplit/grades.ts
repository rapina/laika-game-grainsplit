/**
 * The grade ladder as presentation: the name, the colour, the face the strike
 * tears, and how hard the frame reacts.
 *
 * This table is pure so it can be tested. It decides nothing about judgment —
 * which grade fired is settled in rules.ts/engine.ts and never here — it only
 * decides how that grade is spoken and shown.
 *
 * Two rules this table exists to keep:
 *
 *  1. Every grade is called by its name on screen, during play, at the moment
 *     it fires. A grade that is only counted on the result screen teaches the
 *     player nothing about what to do better.
 *  2. Adjacent grades must be tellable apart from a single frame, with no
 *     second capture to compare against. So they differ in KIND, not only in
 *     amount: below 정타 the gash is a dark hairline, at 정타 and above it
 *     tears open and the pale end grain inside is plainly visible.
 */

import { STRINGS, type Lang } from './strings'
import type { Tier } from './rules'

/** Lowest rung first. The order the ladder is drawn in. */
export const TIER_LADDER: readonly Tier[] = ['miss', 'bite', 'precise', 'grain']

/** How long the grade name stays popped after the strike that fired it, in ms. */
export const GRADE_POP_MS = 420

// Palette values, matching the C table in GrainsplitGame.ts.
const TEXT_DIM = 0x9c8b72
const FRESH = 0xe8d6ac
const FRESH_DEEP = 0xc9b184
const WOOD_DARK = 0x5f4325
const BARK_DARK = 0x33241a
const SAP = 0x9dc27a

/**
 * The grade is spoken in its own colour, and the same colour lights that rung
 * of the ladder, so the word and the rung read as the same thing.
 */
export const TIER_COLOR: Record<Tier, number> = {
    miss: TEXT_DIM, // nothing came out of the log
    bite: FRESH_DEEP, // it bit, and that is all
    precise: SAP, // the same green as the ring and the target band
    grain: FRESH, // the pale face of wood that gave way
}

export interface CrackFace {
    /** Half-width of the gash this grade tears, in px. */
    width: number
    /** How far the pale end grain shows beyond the gash. 0 = no face at all. */
    lip: number
    /** Lit lip colour. */
    face: number
    /** Shadowed lip colour. */
    shade: number
    /** Torn fibre length multiplier along the lips. 0 = bare. */
    fringe: number
}

/**
 * A bite leaves a dark hairline with no pale wood showing; a 정타 tears the
 * face open pale and wide. Each stroke keeps the face its own grade tore, so a
 * broad pale run sits directly above the narrow dark ones it followed, in the
 * same frame, with nothing to measure against.
 */
export const CRACK_FACE: Record<Tier, CrackFace> = {
    miss: { width: 1.0, lip: 0, face: WOOD_DARK, shade: WOOD_DARK, fringe: 0 },
    bite: { width: 2.4, lip: 1.2, face: WOOD_DARK, shade: BARK_DARK, fringe: 0 },
    precise: { width: 8.5, lip: 6.5, face: FRESH, shade: FRESH_DEEP, fringe: 1 },
    grain: { width: 12, lip: 9.5, face: FRESH, shade: FRESH_DEEP, fringe: 1.7 },
}

export interface StrikeFeel {
    /** Hit stop, in ms. */
    stop: number
    /** Screen shake amplitude, in px. */
    shake: number
    /** Dust particles thrown. */
    dust: number
    /** How deep the wedge seats into the top face, in px. */
    seat: number
}

/** The same ladder in time, motion and depth, so it is felt as well as read. */
export const STRIKE_FEEL: Record<Tier, StrikeFeel> = {
    miss: { stop: 22, shake: 3, dust: 6, seat: 2 },
    bite: { stop: 48, shake: 5, dust: 24, seat: 11 },
    precise: { stop: 105, shake: 10, dust: 80, seat: 29 },
    grain: { stop: 152, shake: 14, dust: 124, seat: 40 },
}

/** The grade's name in the language on screen. Never falls back to a key. */
export function gradeLabel(lang: Lang, tier: Tier): string {
    return STRINGS[lang].tier[tier]
}
