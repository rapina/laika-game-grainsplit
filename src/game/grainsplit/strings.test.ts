import { describe, it, expect } from 'vitest'
import { STRINGS } from './strings'

/**
 * Korean and English must carry the same information, and no user-facing string
 * may contain an em dash or en dash.
 */
const locales = ['ko', 'en'] as const

function flatten(table: Record<string, unknown>, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(table)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (typeof value === 'string') out[path] = value
        else if (typeof value === 'function') out[path] = String((value as (...a: never[]) => string)(...([7, 14] as never[])))
        else if (value && typeof value === 'object') Object.assign(out, flatten(value as Record<string, unknown>, path))
    }
    return out
}

describe('strings', () => {
    it('exposes exactly ko and en', () => {
        expect(Object.keys(STRINGS).sort()).toEqual(['en', 'ko'])
    })

    it('has the same key set in both languages', () => {
        const ko = Object.keys(flatten(STRINGS.ko)).sort()
        const en = Object.keys(flatten(STRINGS.en)).sort()
        expect(ko).toEqual(en)
    })

    it('has no empty value in either language', () => {
        for (const locale of locales) {
            for (const [key, value] of Object.entries(flatten(STRINGS[locale]))) {
                expect(value.trim(), `${locale}.${key}`).not.toBe('')
            }
        }
    })

    it('uses no em dash or en dash anywhere', () => {
        for (const locale of locales) {
            for (const [key, value] of Object.entries(flatten(STRINGS[locale]))) {
                expect(value, `${locale}.${key}`).not.toMatch(/[–—]/)
            }
        }
    })

    it('keeps the numbers in interpolated strings in both languages', () => {
        expect(STRINGS.ko.logCounter(7, 14)).toContain('7')
        expect(STRINGS.en.logCounter(7, 14)).toContain('7')
        expect(STRINGS.ko.endTitle(9, 14)).toContain('9')
        expect(STRINGS.en.endTitle(9, 14)).toContain('9')
        expect(STRINGS.ko.swing(41)).toContain('41')
        expect(STRINGS.en.swing(41)).toContain('41')
    })
})
