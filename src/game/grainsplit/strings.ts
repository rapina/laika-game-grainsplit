/**
 * Every user-facing string in the game canvas. Korean and English must carry
 * the same information; no em dashes or en dashes anywhere.
 */

export type Lang = 'ko' | 'en'

export const STRINGS = {
    ko: {
        titleName: '결 가르기',
        titleStart: '탭하여 시작',
        guide1: '탭 = 쐐기 박기',
        guide2: '그린 링이 열릴 때',
        guide3: '통나무 14개, 쐐기 3개',
        now: '지금',
        logCounter: (n: number, total: number) => `통나무 ${n}/${total}`,
        early: '빠름',
        late: '늦음',
        over: '초과',
        short: '부족',
        bandReached: (b: number) => `밴드 ${b}`,
        tier: { miss: '빗나감', bite: '물림', precise: '정타', grain: '결' },
        endTitle: (n: number, total: number) => `끝 · 통나무 ${n}/${total}`,
        avgAccuracy: (v: string) => `평균 정확도 ${v}`,
        swing: (v: number) => `흔들림 ±${v}ms`,
        preciseTaps: (n: number) => `정타·결 ${n}회`,
        score: (n: string) => `총점 ${n}`,
        grainRule: '결: 결 창 안에서 띠에 세운 탭',
        retry: '다시 (R)',
        paused: '멈춤',
        resumeHint: '탭하여 계속',
        muted: '음소거',
    },
    en: {
        titleName: 'GRAINSPLIT',
        titleStart: 'Tap to start',
        guide1: 'Tap = drive the wedge',
        guide2: 'When the green ring opens',
        guide3: '14 logs, 3 wedges',
        now: 'NOW',
        logCounter: (n: number, total: number) => `Log ${n}/${total}`,
        early: 'EARLY',
        late: 'LATE',
        over: 'over',
        short: 'short',
        bandReached: (b: number) => `Band ${b}`,
        tier: { miss: 'MISS', bite: 'BITE', precise: 'TRUE', grain: 'GRAIN' },
        endTitle: (n: number, total: number) => `END · Logs ${n}/${total}`,
        avgAccuracy: (v: string) => `Average accuracy ${v}`,
        swing: (v: number) => `Swing ±${v}ms`,
        preciseTaps: (n: number) => `${n} true/grain taps`,
        score: (n: string) => `Score ${n}`,
        grainRule: 'Grain: a tap inside the grain window that parks the crack in the band',
        retry: 'Again (R)',
        paused: 'PAUSED',
        resumeHint: 'Tap to resume',
        muted: 'MUTED',
    },
} as const

export function strings(lang: Lang) {
    return STRINGS[lang]
}
