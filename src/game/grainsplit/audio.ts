/**
 * Synthesized sound for the core verb. No audio files.
 *
 * Every sound describes the input and the material's answer to it: the wedge
 * biting, the fibres tearing, the log letting go. Judgment grade is audible in
 * timbre and weight, not only in volume, and nothing here is the ONLY channel
 * carrying a signal (the screen always shows the same thing).
 */

import type { Tier } from './rules'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = false

/** Must be called from a user gesture. Silent before that, by design. */
export function unlock(): void {
    if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return }
    try {
        const AC = window.AudioContext
            || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        ctx = new AC()
        master = ctx.createGain()
        master.gain.value = muted ? 0 : 1
        master.connect(ctx.destination)
    } catch { ctx = null }
}

export function setMuted(value: boolean): void {
    muted = value
    if (master) master.gain.value = value ? 0 : 1
}

export function isMuted(): boolean { return muted }

export function suspend(): void { if (ctx && ctx.state === 'running') void ctx.suspend() }
export function resume(): void { if (ctx && ctx.state === 'suspended') void ctx.resume() }

export function destroy(): void {
    try { void ctx?.close() } catch { /* already gone */ }
    ctx = null
    master = null
}

function noiseBuffer(seconds: number, shape: (t: number) => number): AudioBuffer | null {
    if (!ctx) return null
    const n = Math.max(1, Math.floor(ctx.sampleRate * seconds))
    const buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * shape(i / n)
    return buf
}

function playNoise(seconds: number, shape: (t: number) => number, filter: { type: BiquadFilterType, freq: number, q?: number }, gain: number, delay = 0): void {
    if (!ctx || !master) return
    const buf = noiseBuffer(seconds, shape)
    if (!buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    const flt = ctx.createBiquadFilter()
    flt.type = filter.type
    flt.frequency.value = filter.freq
    if (filter.q !== undefined) flt.Q.value = filter.q
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(flt).connect(g).connect(master)
    src.start(ctx.currentTime + delay)
}

function playTone(freqFrom: number, freqTo: number, seconds: number, type: OscillatorType, gain: number, delay = 0): void {
    if (!ctx || !master) return
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freqFrom, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t + seconds)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
    osc.connect(g).connect(master)
    osc.start(t)
    osc.stop(t + seconds + 0.02)
}

/** The wedge strike. Grade is audible in the bite's depth and the tear's length. */
export function sfxStrike(tier: Tier): void {
    if (!ctx) return
    switch (tier) {
        case 'miss':
            // Iron skids off wood: bright, hollow, no tear underneath.
            playTone(1400, 620, 0.07, 'square', 0.05)
            playNoise(0.06, (t) => Math.pow(1 - t, 4), { type: 'bandpass', freq: 2600, q: 3 }, 0.16)
            break
        case 'bite':
            // Wedge sinks part way, fibres give unevenly.
            playTone(190, 78, 0.14, 'triangle', 0.24)
            playNoise(0.05, (t) => Math.pow(1 - t, 3), { type: 'highpass', freq: 1600 }, 0.2)
            playNoise(0.22, (t) => Math.pow(1 - t, 1.6) * (0.6 + 0.4 * Math.sin(t * 90)), { type: 'bandpass', freq: 900, q: 1.2 }, 0.16, 0.02)
            break
        case 'precise':
            // Solid seat, then a long clean rip along the grain.
            playTone(150, 52, 0.2, 'triangle', 0.34)
            playNoise(0.05, (t) => Math.pow(1 - t, 3), { type: 'highpass', freq: 2200 }, 0.3)
            playNoise(0.34, (t) => Math.pow(1 - t, 1.3) * (0.7 + 0.3 * Math.sin(t * 140)), { type: 'bandpass', freq: 1250, q: 0.9 }, 0.24, 0.02)
            break
        case 'grain':
            // The log gives up along its own grain: deepest seat, longest tear.
            playTone(132, 44, 0.26, 'triangle', 0.38)
            playNoise(0.06, (t) => Math.pow(1 - t, 3), { type: 'highpass', freq: 2600 }, 0.34)
            playNoise(0.5, (t) => Math.pow(1 - t, 1.1) * (0.7 + 0.3 * Math.sin(t * 180)), { type: 'bandpass', freq: 1500, q: 0.8 }, 0.28, 0.02)
            break
    }
}

/** The log finally parts in two. */
export function sfxSplit(): void {
    playTone(110, 38, 0.5, 'sine', 0.3)
    playNoise(0.6, (t) => Math.pow(1 - t, 1.1), { type: 'lowpass', freq: 2200 }, 0.3)
    playTone(320, 210, 0.3, 'triangle', 0.1, 0.06)
}

/** The crack ran past the band and the log burst. */
export function sfxShatter(): void {
    playNoise(0.7, (t) => Math.pow(1 - t, 0.8), { type: 'highpass', freq: 700 }, 0.42)
    playTone(90, 32, 0.6, 'sawtooth', 0.24)
    for (let i = 0; i < 5; i++) {
        playNoise(0.1, (t) => Math.pow(1 - t, 3), { type: 'bandpass', freq: 1200 + i * 700, q: 4 }, 0.13, 0.04 + i * 0.05)
    }
}

/** A wedge snaps: one of the three beside the cradle is gone. */
export function sfxWedgeSnap(): void {
    playTone(880, 190, 0.13, 'square', 0.16)
    playNoise(0.16, (t) => Math.pow(1 - t, 2.4), { type: 'bandpass', freq: 3200, q: 5 }, 0.22)
    playTone(150, 60, 0.24, 'triangle', 0.16, 0.03)
}

/** Run over. */
export function sfxEnd(): void {
    playTone(220, 70, 0.9, 'triangle', 0.2)
    playTone(146, 48, 1.2, 'sine', 0.16, 0.12)
    playNoise(0.5, (t) => Math.pow(1 - t, 2), { type: 'lowpass', freq: 900 }, 0.14, 0.05)
}
