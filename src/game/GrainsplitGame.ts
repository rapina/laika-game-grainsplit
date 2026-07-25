import { Application, Container, Graphics, Text, Sprite, Assets, Texture, type TextStyleOptions } from 'pixi.js'
import { APP_CONFIG } from '../appConfig'
import type { GameCallbacks, GameRuntime, GameResult } from './types'
import {
    createRun, step, tap, summarize, currentErrorMs, ringOpen, recoilHeight,
    bandNear, bandFar, STEP_MS, TOTAL_LOGS, FAILURE_BUDGET,
    type RunState, type Tier,
} from './grainsplit/engine'
import { fibreAt } from './grainsplit/rules'
import {
    CRACK_FACE, GRADE_POP_MS, STRIKE_FEEL, TIER_COLOR, TIER_LADDER, gradeLabel,
} from './grainsplit/grades'
import { strings, type Lang } from './grainsplit/strings'
import * as sound from './grainsplit/audio'

const W = APP_CONFIG.designWidth
const H = APP_CONFIG.designHeight

/** Play area sits above this line; the guide strip lives below it. */
const PLAY_BOTTOM = H - 96

const DISC_CX = W / 2
const DISC_CY = 440
const DISC_R = 140
/** Horizon. The wedge and its ring ride above this, against the dusk sky. */
const HORIZON = 300
/** How far the log rides up out of its cradle at the top of the recoil. */
const BOB = 20
/** Baseline of the spoken grade name, and of the ladder under it. Clear sky,
 *  above the ring at y=218 and below the top control row. */
const GRADE_Y = 152
const LADDER_Y = 180

// Palette: sepia wet hardwood + pale cream fresh wood. Sap green only for the
// target band and success marks. Failure is marked by shape, not by colour.
const C = {
    skyTop: 0x2a2420,
    skyMid: 0x6b4526,
    skyLow: 0xb9722f,
    ground: 0x241a14,
    groundFar: 0x3a2a1e,
    bark: 0x4a3524,
    barkDark: 0x33241a,
    wood: 0x8a6236,
    woodLight: 0xa87c47,
    woodDark: 0x5f4325,
    ring: 0x6d4c29,
    fresh: 0xe8d6ac,
    freshDeep: 0xc9b184,
    sap: 0x9dc27a,
    sapDim: 0x6f8f56,
    iron: 0x6a6c72,
    ironDark: 0x3a3c42,
    ironLight: 0x9a9ca4,
    text: 0xe6dcc8,
    textDim: 0x9c8b72,
    panel: 0x1a120c,
    dust: 0xd8c193,
}

function font(size: number, fill: number, bold = false): TextStyleOptions {
    return {
        fill,
        fontSize: size,
        fontFamily: bold ? 'Galmuri14, Galmuri11, monospace' : 'Galmuri11, monospace',
        fontWeight: bold ? 'bold' : 'normal',
    }
}

interface Dust { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number }
interface Shard {
    pts: number[]; x: number; y: number; vx: number; vy: number; rot: number; vrot: number
    /** Wedge of the original disc this piece came off, so it keeps its rings. */
    a0: number; a1: number; r: number
}
interface CrackPoint { x: number; y: number; w: number; tier: Tier }

type Phase = 'title' | 'play' | 'over'

export class GrainsplitGame implements GameRuntime {
    private app: Application | null = null
    private callbacks: GameCallbacks | null = null
    private destroyed = false
    private resizeObs: ResizeObserver | null = null
    private container: HTMLElement | null = null

    private run: RunState = createRun('1')
    private phase: Phase = 'title'
    private lang: Lang = 'ko'
    private paused = false
    private hostPaused = false
    private accumulator = 0
    private seed = '1'
    private runCounter = 0

    // presentation state
    private crackPoints: CrackPoint[] = []
    private renderedP = 0
    private pendingP = 0
    private pendingWidth = 1
    private pendingTier: Tier = 'bite'
    /** Counts down after each strike; drives the pop on the grade name. */
    private gradeAnim = 0
    private segAngle = 0
    private lateral = 0
    private dust: Dust[] = []
    private shards: Shard[] = []
    private strike: { ms: number; total: number; tier: Tier; kick: number } | null = null
    private hitStopMs = 0
    private shakeMs = 0
    private shakeAmp = 0
    private splitOpen = 0
    /** True once the seam faces are painted into the halves and the log is two pieces. */
    private splitSeamPainted = false
    private wedgeSnapAnim = 0
    private lastLogIndex = 1
    private resultDelivered = false
    private overSinceMs = 0
    private titleTexture: Texture | null = null

    // display objects
    private root = new Container()
    private worldLayer = new Container()
    private bgLayer = new Container()
    private discLayer = new Container()
    private cradleGfx = new Graphics()
    private discWhole = new Graphics()
    private discHalfL = new Graphics()
    private discHalfR = new Graphics()
    private maskL = new Graphics()
    private maskR = new Graphics()
    private discPaintedFor = -1
    private crackGfx = new Graphics()
    private shardGfx = new Graphics()
    private wedgeGfx = new Graphics()
    private ringGfx = new Graphics()
    private dustGfx = new Graphics()
    private pileGfx = new Graphics()
    private budgetGfx = new Graphics()
    private markerGfx = new Graphics()
    private hudLayer = new Container()
    private guideLayer = new Container()
    private overlayLayer = new Container()

    private counterText = new Text({ text: '', style: font(15, C.text, true) })
    private cueText = new Text({ text: '', style: font(14, C.text, true) })
    private failText = new Text({ text: '', style: font(13, C.text, true) })
    private nowText = new Text({ text: '', style: font(13, C.sap, true) })
    /** The grade, called by its name, at the moment it fires. */
    private gradeText = new Text({ text: '', style: font(30, C.text, true) })
    /** The four rungs, so the grade just earned is read against the one above it. */
    private ladderTexts: Text[] = []
    private guideTexts: Text[] = []
    private ctrlTexts: Text[] = []

    // -------------------------------------------------------------- lifecycle

    async mount(container: HTMLElement, callbacks: GameCallbacks): Promise<void> {
        this.callbacks = callbacks
        this.container = container
        this.lang = detectLang()

        const app = new Application()
        await app.init({
            width: W,
            height: H,
            backgroundColor: C.skyTop,
            antialias: true,
            // Never pin render scale below the device pixel ratio. If this ever
            // needs to be cheaper, cut particles, not resolution.
            resolution: Math.max(1, Math.min(window.devicePixelRatio || 1, 3)),
            autoDensity: true,
        })
        if (this.destroyed) { app.destroy(true, { children: true }); return }
        this.app = app
        container.appendChild(app.canvas)
        app.canvas.style.display = 'block'
        this.fit()
        this.resizeObs = new ResizeObserver(() => this.fit())
        this.resizeObs.observe(container)

        this.titleTexture = await Assets.load<Texture>(titleKeyUrl()).catch(() => null)
        if (this.destroyed) { app.destroy(true, { children: true }); return }

        this.buildScene()
        this.startRun(this.nextSeed())

        window.addEventListener('keydown', this.onKeyDown)
        app.canvas.addEventListener('pointerdown', this.onPointerDown)
        app.ticker.add((ticker) => this.frame(ticker.deltaMS))
    }

    destroy(): void {
        this.destroyed = true
        window.removeEventListener('keydown', this.onKeyDown)
        this.app?.canvas.removeEventListener('pointerdown', this.onPointerDown)
        this.resizeObs?.disconnect()
        this.resizeObs = null
        sound.destroy()
        if (!this.app) return
        this.app.destroy(true, { children: true })
        this.app = null
    }

    /**
     * Uniform-scale letterbox. The scene never stretches, whatever the host
     * aspect is.
     *
     * The renderer resolution tracks devicePixelRatio TIMES the displayed
     * scale, so the backing store always has at least one device pixel per CSS
     * pixel even when the frame is scaled up on a large screen. Pinning it to
     * bare devicePixelRatio would under-render exactly on the big viewports.
     */
    private fit(): void {
        const app = this.app
        const el = this.container
        if (!app || !el) return
        const cw = el.clientWidth
        const ch = el.clientHeight
        if (!cw || !ch) return
        const dpr = Math.max(1, window.devicePixelRatio || 1)
        // A hair of margin so rounding up the backing store can never push the
        // canvas past the edge of the frame.
        const scale = Math.min(cw / W, ch / H) * 0.999
        const resolution = Math.max(1, Math.min(dpr * scale, 4))
        if (Math.abs(app.renderer.resolution - resolution) > 0.0005) {
            app.renderer.resize(W, H, resolution)
        }
        // Derive the CSS size back out of the actual backing store, so
        // buffer / CSS is exactly devicePixelRatio instead of a rounded
        // approximation of it.
        app.canvas.style.width = `${app.renderer.canvas.width / dpr}px`
        app.canvas.style.height = `${app.renderer.canvas.height / dpr}px`
    }

    // -------------------------------------------------------------- host controls

    setPaused(value: boolean): void {
        this.hostPaused = value
        if (value) sound.suspend()
        else if (!this.paused) sound.resume()
    }

    setMuted(value: boolean): void { sound.setMuted(value) }

    setLocale(locale: Lang): void {
        this.lang = locale === 'en' ? 'en' : 'ko'
        this.refreshStaticText()
    }

    restartRun(): void {
        this.startRun(this.nextSeed())
    }

    getDebugState(): Record<string, unknown> {
        const log = this.run.log
        return {
            over: this.phase === 'over',
            phase: this.phase,
            score: summarize(this.run).score,
            logIndex: log.index,
            band: log.band.index,
            splits: this.run.splits,
            failures: this.run.failures,
            crackP: Math.round(log.crackP * 1000) / 1000,
            bandNear: Math.round(bandNear(log) * 1000) / 1000,
            bandFar: Math.round(bandFar(log) * 1000) / 1000,
            ringOpen: this.phase === 'play' && (!this.run.started || ringOpen(log)),
            errorMs: Math.round(currentErrorMs(log)),
            // The material reaction itself, so verification can wait for the log
            // to actually come apart instead of guessing at a delay.
            outcome: log.outcome,
            resolveMs: Math.round(log.resolveMs),
            splitOpen: Math.round(this.splitOpen * 100) / 100,
            crackDrawnP: Math.round(this.renderedP * 1000) / 1000,
            lastTapTier: log.lastTap?.tier ?? null,
            lastTapErrorMs: log.lastTap ? Math.round(log.lastTap.errorMs) : null,
            // The grade name as it is actually painted this frame, and whether
            // it is on screen. Verification reads these so "the grade was
            // called by its name during play" is checked, not assumed.
            gradeLabel: this.gradeText.visible ? this.gradeText.text : null,
            gradeShown: this.gradeText.visible,
            gradeLadder: this.ladderTexts.filter((t) => t.visible).map((t) => t.text),
            guideVisible: this.run.guideVisible,
            started: this.run.started,
            elapsedMs: Math.round(this.run.elapsedMs),
            tapBudgetLeft: log.tapBudget - log.tapsUsed,
            muted: sound.isMuted(),
            paused: this.paused || this.hostPaused,
            lang: this.lang,
        }
    }

    // -------------------------------------------------------------- run control

    /** Reproducible when a seed is supplied (autoplay / smoke), random otherwise. */
    private nextSeed(): string {
        const fixed = (globalThis as unknown as { __grainsplitSeed?: string }).__grainsplitSeed
        this.runCounter += 1
        return fixed ? `${fixed}-${this.runCounter}` : String(Math.floor(Math.random() * 1e9))
    }

    private startRun(seed: string): void {
        this.seed = seed
        this.run = createRun(seed)
        this.phase = 'title'
        this.resultDelivered = false
        this.overSinceMs = 0
        this.resetLogPresentation()
        this.shards = []
        this.dust = []
        this.lastLogIndex = 1
        this.accumulator = 0
        this.refreshStaticText()
    }

    private resetLogPresentation(): void {
        this.crackPoints = []
        this.renderedP = 0
        this.pendingP = 0
        this.lateral = 0
        this.segAngle = 0
        this.splitOpen = 0
        this.splitSeamPainted = false
        this.pendingWidth = 1
        this.pendingTier = 'bite'
        this.gradeAnim = 0
        this.strike = null
        this.discPaintedFor = -1
    }

    // -------------------------------------------------------------- input

    private onKeyDown = (e: KeyboardEvent) => {
        const k = e.key.toLowerCase()
        if (k === ' ' || e.code === 'Space' || k === 'enter') { e.preventDefault(); this.primaryInput(); return }
        if (k === 'r') { e.preventDefault(); this.onRestartInput(); return }
        if (k === 'm') { e.preventDefault(); sound.setMuted(!sound.isMuted()); this.refreshStaticText(); return }
        if (k === 'p') { e.preventDefault(); this.togglePause(); return }
        if (k === 'l') { e.preventDefault(); this.setLocale(this.lang === 'ko' ? 'en' : 'ko'); return }
    }

    private onPointerDown = (e: PointerEvent) => {
        const rect = (this.app?.canvas as HTMLCanvasElement).getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * W
        const y = ((e.clientY - rect.top) / rect.height) * H
        // Small control row, top right. 44px touch targets.
        if (y < 52 && x > W - 150) {
            if (x > W - 52) { this.setLocale(this.lang === 'ko' ? 'en' : 'ko'); return }
            if (x > W - 100) { sound.setMuted(!sound.isMuted()); this.refreshStaticText(); return }
            this.togglePause()
            return
        }
        this.primaryInput()
    }

    private togglePause(): void {
        if (this.phase !== 'play') return
        this.paused = !this.paused
        if (this.paused) sound.suspend()
        else sound.resume()
    }

    private primaryInput(): void {
        sound.unlock()
        if (this.phase === 'title') { this.phase = 'play'; this.refreshStaticText(); return }
        if (this.phase === 'over') { this.onRestartInput(); return }
        if (this.paused) { this.paused = false; sound.resume(); return }
        if (this.hostPaused) return

        const before = this.run.failures
        const result = tap(this.run)
        if (!result) return

        sound.sfxStrike(result.tier)
        // The wedge itself has to be seen driving in. Grade changes how deep it
        // seats and, on a miss, how hard it skids off.
        const total = result.tier === 'miss' ? 300 : 340
        this.strike = { ms: total, total, tier: result.tier, kick: result.tier === 'miss' ? (Math.random() < 0.5 ? -1 : 1) : 0 }
        this.applyStrikeFeel(result.tier, result.knotHit)
        // On the tap that lands it, the crack runs the rest of the way out the
        // bottom of the log: a split log parts through, it does not stop at the
        // band. This is presentation only; the engine's crackP is untouched and
        // the band judgment has already been made from it.
        this.pendingP = result.outcome === 'split' ? 1 : this.run.log.crackP
        // What this strike tears open. The grade is legible from the face it
        // leaves: a bite is a dark hairline, a true strike opens pale end
        // grain. See CRACK_FACE.
        this.pendingTier = result.tier
        this.pendingWidth = CRACK_FACE[result.tier].width
        // Say the grade's name, now, while the wedge is still going in.
        this.gradeAnim = GRADE_POP_MS
        // A log that finally lets go runs out close to straight along its own
        // grain, so the run-out does not inherit the full accumulated bend.
        this.segAngle = result.outcome === 'split'
            ? this.run.log.crackAngle * 0.35
            : this.run.log.crackAngle

        if (result.outcome === 'split') { sound.sfxSplit() }
        if (result.outcome === 'shatter') { sound.sfxShatter(); this.makeShards() }
        if (this.run.failures > before) {
            this.wedgeSnapAnim = 420
            sound.sfxWedgeSnap()
        }
    }

    private onRestartInput(): void {
        if (this.phase === 'over') {
            // Short guard so a stray tap right after the run ends cannot skip
            // past the result screen before it has been read.
            if (this.overSinceMs < 900) return
            this.startRun(this.nextSeed())
            this.phase = 'play'
            this.refreshStaticText()
            return
        }
        if (this.phase === 'title') return
        this.startRun(this.nextSeed())
    }

    /** Judgment grade is separated in time as well as in sight and sound. */
    private applyStrikeFeel(tier: Tier, knotHit: boolean): void {
        // Adjacent grades are separated hard here too: a bite barely stops the
        // frame and throws a puff, a true strike stops it twice as long and
        // throws three times the dust. See STRIKE_FEEL.
        const spec = STRIKE_FEEL[tier]
        this.hitStopMs = spec.stop
        this.shakeMs = 180
        this.shakeAmp = spec.shake + (knotHit ? 4 : 0)
        const extra = knotHit ? 14 : 0
        // Two sprays, because two things happen: the wedge bites the top face,
        // and the crack tip tears fibre further down.
        this.spawnDust(Math.round(spec.dust * 0.62) + extra, DISC_CX, DISC_CY - DISC_R + this.logBobY(), 1.5)
        this.spawnDust(spec.dust - Math.round(spec.dust * 0.62), DISC_CX + this.lateral, this.crackTipY(), 1)
    }

    /** Screen y of the crack tip as currently drawn. */
    private crackTipY(): number {
        return DISC_CY - DISC_R + this.renderedP * DISC_R * 2
    }

    private spawnDust(n: number, x: number, y: number, power = 1): void {
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.1
            const sp = (1.2 + Math.random() * 4.4) * power
            this.dust.push({
                x: x + (Math.random() - 0.5) * 10,
                y,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp - 1.2 * power,
                life: 0,
                max: 420 + Math.random() * 520,
                size: 0.8 + Math.random() * 2.1,
            })
        }
    }

    private makeShards(): void {
        const log = this.run.log
        const n = 6 + Math.floor(Math.random() * 3)
        for (let i = 0; i < n; i++) {
            const a0 = (i / n) * Math.PI * 2
            const a1 = ((i + 1) / n) * Math.PI * 2
            const r = DISC_R * (0.55 + Math.random() * 0.45)
            const pts = [0, 0]
            for (let k = 0; k <= 4; k++) {
                const a = a0 + ((a1 - a0) * k) / 4
                const rr = r * (0.82 + Math.random() * 0.3)
                pts.push(Math.cos(a) * rr, Math.sin(a) * rr)
            }
            const mid = (a0 + a1) / 2
            this.shards.push({
                pts,
                x: DISC_CX, y: DISC_CY,
                vx: Math.cos(mid) * (1.2 + Math.random() * 2.4),
                vy: Math.sin(mid) * (1.2 + Math.random() * 2.4) - 1.5,
                rot: 0,
                vrot: (Math.random() - 0.5) * 0.22,
                a0, a1, r,
            })
        }
        void log
    }

    // -------------------------------------------------------------- frame

    private frame(deltaMS: number): void {
        if (this.destroyed || !this.app) return
        const dt = Math.min(deltaMS, 100) // clamp the resume frame

        if (this.phase === 'play' && !this.paused && !this.hostPaused) {
            if (this.hitStopMs > 0) {
                this.hitStopMs = Math.max(0, this.hitStopMs - dt)
            } else {
                this.accumulator += dt
                while (this.accumulator >= STEP_MS) {
                    step(this.run, STEP_MS)
                    this.accumulator -= STEP_MS
                }
            }
            if (this.run.log.index !== this.lastLogIndex) {
                this.lastLogIndex = this.run.log.index
                this.resetLogPresentation()
                this.shards = []
            }
            if (this.run.over && this.phase === 'play') {
                this.phase = 'over'
                this.overSinceMs = 0
                sound.sfxEnd()
                this.deliverResult()
            }
        }
        if (this.phase === 'over') this.overSinceMs += dt

        this.advancePresentation(dt)
        this.draw()

        // Publish runtime state every frame. A 100ms poll cannot observe a
        // judgment window only a few milliseconds wide, which is exactly what
        // the verification captures have to aim at.
        ;(globalThis as unknown as Record<string, unknown>).__gameState = this.getDebugState()
    }

    private advancePresentation(dt: number): void {
        // The crack tip walks the fibre field over real frames; this is the
        // fracture propagation, not a jump to the new position.
        if (this.renderedP < this.pendingP) {
            // Fast enough that the strike and the crack it drives read as one
            // event: a full tap's reach is torn open inside ~60ms.
            const speed = 0.0034 * dt // fraction of log length per ms
            const stepP = Math.min(speed, this.pendingP - this.renderedP)
            const yScale = DISC_R * 2
            const nodes = this.run.log.fibreNodes
            const steps = Math.max(1, Math.ceil(stepP / 0.004))
            for (let i = 0; i < steps; i++) {
                const sp = stepP / steps
                this.renderedP += sp
                const wobble = fibreAt(nodes, this.renderedP) * 1.4 + (Math.random() - 0.5) * 1.1
                this.lateral += Math.tan(this.segAngle) * sp * yScale + wobble * 0.35
                // The seam has to stay on the log, or the mask cuts one half to
                // nothing and the split reads as the log vanishing.
                const limit = DISC_R - 34
                this.lateral = Math.max(-limit, Math.min(limit, this.lateral))
                this.crackPoints.push({
                    x: DISC_CX + this.lateral,
                    y: DISC_CY - DISC_R + this.renderedP * yScale,
                    w: this.pendingWidth,
                    tier: this.pendingTier,
                })
            }
        }

        // The halves only start moving once the crack has actually run all the
        // way through. Until then the log is still one piece and it looks it.
        if (this.run.log.outcome === 'split' && this.renderedP >= 0.999) {
            if (!this.splitSeamPainted) {
                this.splitSeamPainted = true
                this.repaintHalvesWithSeam()
                // The log giving way throws far more dust than any single tap.
                this.spawnDust(70, DISC_CX + this.lateral, DISC_CY, 1.9)
                this.shakeMs = 260
                this.shakeAmp = 14
            }
            this.splitOpen = Math.min(1, this.splitOpen + dt / 620)
        }

        if (this.strike) {
            this.strike.ms -= dt
            if (this.strike.ms <= 0) this.strike = null
        }
        if (this.gradeAnim > 0) this.gradeAnim = Math.max(0, this.gradeAnim - dt)
        if (this.shakeMs > 0) this.shakeMs = Math.max(0, this.shakeMs - dt)
        if (this.wedgeSnapAnim > 0) this.wedgeSnapAnim = Math.max(0, this.wedgeSnapAnim - dt)

        for (const d of this.dust) {
            d.life += dt
            d.x += d.vx * dt * 0.06
            d.y += d.vy * dt * 0.06
            d.vy += dt * 0.0016
        }
        this.dust = this.dust.filter((d) => d.life < d.max)

        // A shattered log drops onto the block and stays there. Letting the
        // pieces sail off leaves the last thing on screen an empty cradle, and
        // the wreck is exactly what the run is supposed to end on.
        const restY = DISC_CY + DISC_R + 24
        for (const s of this.shards) {
            s.x += s.vx * dt * 0.06
            s.y += s.vy * dt * 0.06
            s.vy += dt * 0.0026
            s.rot += s.vrot * dt * 0.06
            const limit = DISC_R + 40
            if (Math.abs(s.x - DISC_CX) > limit) {
                s.x = DISC_CX + Math.sign(s.x - DISC_CX) * limit
                s.vx *= -0.4
            }
            if (s.y >= restY) {
                s.y = restY
                s.vy = -s.vy * 0.26
                s.vx *= 0.5
                s.vrot *= 0.35
                if (Math.abs(s.vy) < 0.7) { s.vy = 0; s.vx = 0; s.vrot = 0 }
            }
        }
    }

    private deliverResult(): void {
        if (this.resultDelivered) return
        this.resultDelivered = true
        const s = summarize(this.run)
        const result: GameResult = { score: s.score, phase: s.bandReached }
        this.callbacks?.onGameOver(result)
    }

    // -------------------------------------------------------------- scene

    private buildScene(): void {
        const app = this.app!
        this.root.addChild(this.worldLayer, this.hudLayer, this.guideLayer, this.overlayLayer)
        this.discLayer.addChild(this.discWhole, this.discHalfL, this.discHalfR)
        // The masks are children of the halves they cut, so the seam travels
        // with its half. A sibling mask would hold still while the half slid
        // out from under it and the cut would drift off the crack.
        this.discHalfL.addChild(this.maskL)
        this.discHalfR.addChild(this.maskR)
        this.discHalfL.mask = this.maskL
        this.discHalfR.mask = this.maskR
        // Each half tips about where it rests on the cradle, so they fall apart
        // outwards rather than spinning around the middle of the log.
        for (const [half, side] of [[this.discHalfL, -1], [this.discHalfR, 1]] as const) {
            half.pivot.set(DISC_CX + side * DISC_R * 0.5, DISC_CY + DISC_R)
            half.position.set(DISC_CX + side * DISC_R * 0.5, DISC_CY + DISC_R)
        }
        this.worldLayer.addChild(
            this.bgLayer, this.pileGfx, this.cradleGfx, this.discLayer, this.crackGfx, this.shardGfx,
            this.budgetGfx, this.markerGfx, this.wedgeGfx, this.ringGfx, this.dustGfx,
        )
        app.stage.addChild(this.root)

        this.drawBackground()

        this.counterText.position.set(12, 12)
        this.hudLayer.addChild(this.counterText)

        for (let i = 0; i < 3; i++) {
            const t = new Text({ text: '', style: font(13, C.textDim, true) })
            t.anchor.set(0.5, 0)
            t.position.set(W - 126 + i * 48, 16)
            this.ctrlTexts.push(t)
            this.hudLayer.addChild(t)
        }

        this.cueText.anchor.set(0, 0.5)
        this.hudLayer.addChild(this.cueText)
        this.failText.anchor.set(0.5, 0)
        this.hudLayer.addChild(this.failText)
        this.nowText.anchor.set(0.5, 0.5)
        this.hudLayer.addChild(this.nowText)

        // The grade, spoken above the log the moment the wedge lands, with the
        // four rungs under it so the one just earned is read against the next
        // one up. Both sit in the clear sky above the ring.
        this.gradeText.anchor.set(0.5, 1)
        this.gradeText.position.set(DISC_CX, GRADE_Y)
        this.hudLayer.addChild(this.gradeText)
        for (let i = 0; i < TIER_LADDER.length; i++) {
            const t = new Text({ text: '', style: font(11, C.textDim, true) })
            t.anchor.set(0.5, 1)
            t.position.set(DISC_CX, LADDER_Y)
            this.ladderTexts.push(t)
            this.hudLayer.addChild(t)
        }

        for (let i = 0; i < 3; i++) {
            const t = new Text({ text: '', style: font(14, C.text, i === 0) })
            t.anchor.set(0.5, 0)
            t.position.set(W / 2, PLAY_BOTTOM + 16 + i * 24)
            this.guideTexts.push(t)
            this.guideLayer.addChild(t)
        }
        this.refreshStaticText()
    }

    private refreshStaticText(): void {
        const s = strings(this.lang)
        this.guideTexts[0].text = s.guide1
        this.guideTexts[1].text = s.guide2
        this.guideTexts[2].text = s.guide3
        this.ctrlTexts[0].text = this.paused ? '|>' : '||'
        this.ctrlTexts[1].text = sound.isMuted() ? 'x' : '(*'
        this.ctrlTexts[2].text = this.lang === 'ko' ? 'EN' : '한'
    }

    /** Dusk woodyard: sky bands, treeline, distant stacks, ground. */
    private drawBackground(): void {
        const g = new Graphics()
        for (let i = 0; i < 70; i++) {
            const t = i / 69
            const c = t < 0.62
                ? lerpColor(C.skyTop, C.skyMid, (t / 0.62) ** 1.4)
                : lerpColor(C.skyMid, C.skyLow, (t - 0.62) / 0.38)
            g.rect(0, Math.floor(t * HORIZON), W, 6).fill({ color: c })
        }
        // low sun band just above the treeline
        g.rect(0, HORIZON - 46, W, 26).fill({ color: C.skyLow, alpha: 0.5 })
        // stacked split wood along the horizon, in silhouette
        for (let x = -8; x < W + 8; x += 15) {
            const h = 16 + ((x * 37) % 13)
            g.poly([x, HORIZON, x + 7.5, HORIZON - h, x + 15, HORIZON]).fill({ color: 0x241d18 })
        }
        // distant treeline
        for (let x = -10; x < W + 10; x += 11) {
            const h = 30 + Math.sin(x * 0.21) * 10 + Math.sin(x * 0.07) * 14
            g.poly([x, HORIZON, x + 5.5, HORIZON - h, x + 11, HORIZON]).fill({ color: 0x191512 })
        }
        g.rect(0, HORIZON, W, 26).fill({ color: C.groundFar })
        g.rect(0, HORIZON + 18, W, H - HORIZON - 18).fill({ color: C.ground })
        // ground chips
        for (let i = 0; i < 150; i++) {
            const x = Math.random() * W
            const y = HORIZON + 24 + Math.random() * (PLAY_BOTTOM - HORIZON - 24)
            g.rect(x, y, 2 + Math.random() * 4, 1.5).fill({ color: C.woodDark, alpha: 0.45 })
        }
        this.bgLayer.addChild(g)
    }

    // -------------------------------------------------------------- draw

    private draw(): void {
        const shake = this.shakeMs > 0 ? (this.shakeMs / 180) * this.shakeAmp : 0
        this.worldLayer.position.set(
            shake ? (Math.random() - 0.5) * shake * 2 : 0,
            shake ? (Math.random() - 0.5) * shake * 2 : 0,
        )

        // The log is what bounces. It springs up out of the cradle on its own
        // period and you drive the wedge at the top of that rise, which is the
        // question the game asks.
        const bob = this.logBobY()
        this.discLayer.position.y = bob
        this.crackGfx.position.y = bob
        this.markerGfx.position.y = bob

        this.drawDisc()
        this.drawCrack()
        this.drawShards()
        this.drawPile()
        this.drawBudget()
        this.drawWedgeAndRing()
        this.drawDust()
        this.drawHud()
        this.drawGuide()
        this.drawOverlays()
    }

    /**
     * The disc is static for the life of a log, so it is painted once and then
     * only positioned. When the log gives way, the same paint is shown twice
     * through two masks cut along the crack, which is what makes it read as one
     * log opening into two halves rather than two logs.
     */
    /** Vertical offset of the log this frame. Negative is up. */
    private logBobY(): number {
        const log = this.run.log
        if (this.phase !== 'play' || log.outcome !== null) return 0
        const h = this.run.started ? recoilHeight(log) : 1
        return -((h + 1) / 2) * BOB
    }

    private drawDisc(): void {
        const log = this.run.log
        const shattered = log.outcome === 'shatter'
        this.discWhole.visible = !shattered && !this.splitSeamPainted
        this.discHalfL.visible = !shattered && this.splitSeamPainted
        this.discHalfR.visible = this.discHalfL.visible
        this.drawCradle()
        if (shattered) return

        if (this.discPaintedFor !== log.index) {
            this.discPaintedFor = log.index
            for (const target of [this.discWhole, this.discHalfL, this.discHalfR]) {
                target.clear()
                this.paintDisc(target)
            }
        }

        if (!this.splitSeamPainted) return

        // Two billets coming apart off the cradle: they slide out, tip over
        // outwards, and drop. Nothing here reads as the log merely sliding.
        // Sized so both halves stay legible in frame: they hinge apart at the
        // cradle into a clear V, showing both cut faces, and settle.
        const t = this.splitOpen
        const slide = t ** 0.6 * 24
        const tip = t ** 1.7 * 0.14
        const drop = t ** 2.3 * 30
        for (const [half, side] of [[this.discHalfL, -1], [this.discHalfR, 1]] as const) {
            half.position.set(
                DISC_CX + side * DISC_R * 0.5 + side * slide,
                DISC_CY + DISC_R + drop,
            )
            half.rotation = side * tip
        }
    }

    /** The line the log gave way along, run out past both ends of the disc. */
    private seamPoints(): CrackPoint[] {
        const pts = this.crackPoints.length >= 2
            ? this.crackPoints
            : [
                { x: DISC_CX, y: DISC_CY - DISC_R, w: 6, tier: 'grain' as Tier },
                { x: DISC_CX, y: DISC_CY + DISC_R, w: 6, tier: 'grain' as Tier },
            ]
        const first = pts[0], last = pts[pts.length - 1]
        return [
            { x: first.x, y: DISC_CY - DISC_R - 30, w: first.w, tier: first.tier },
            ...pts,
            // A split log parts all the way through, so the seam runs out the bottom.
            { x: last.x, y: DISC_CY + DISC_R + 30, w: last.w, tier: last.tier },
        ]
    }

    /**
     * Repaint both halves the moment the log gives way: the same wood face as
     * before, plus the torn fresh end grain along the seam. Painting the face
     * into the half (instead of into the free-floating crack layer) is what
     * lets it travel, tip and fall with the piece it belongs to.
     */
    private repaintHalvesWithSeam(): void {
        const seam = this.seamPoints()
        // The seam is run out past both ends of the disc so the mask cuts
        // cleanly, but the exposed face is wood and must stop at the bark.
        const rim = DISC_R - 3
        const inner = seam.filter((p) => {
            const dx = p.x - DISC_CX, dy = p.y - DISC_CY
            return dx * dx + dy * dy <= rim * rim
        })
        const face = inner.length >= 2 ? inner : seam
        const lip = 8
        for (const [g, side] of [[this.discHalfL, -1], [this.discHalfR, 1]] as const) {
            g.clear()
            this.paintDisc(g)
            // the exposed fresh face, on this half's side of the seam
            const poly: number[] = []
            for (const p of face) poly.push(p.x, p.y)
            for (let i = face.length - 1; i >= 0; i--) poly.push(face[i].x + side * lip, face[i].y)
            g.poly(poly).fill({ color: side < 0 ? C.fresh : C.freshDeep })
            // ragged fibre torn off the lip
            for (let i = 1; i < face.length; i += 2) {
                const p = face[i]
                const len = 1.5 + Math.random() * 5
                g.moveTo(p.x + side * lip, p.y)
                g.lineTo(p.x + side * (lip + len), p.y + (Math.random() - 0.5) * 5)
                g.stroke({ color: C.freshDeep, width: 1, alpha: 0.8 })
            }
            // shadow in the very corner of the cut
            g.moveTo(face[0].x, face[0].y)
            for (const p of face) g.lineTo(p.x, p.y)
            g.stroke({ color: 0x2a1a0e, width: 2.5, alpha: 0.7 })
        }
        this.cutMasks()
    }

    /** The mask polygons: the seam, then round the rim on each side. */
    private cutMasks(): void {
        const seam: number[] = []
        for (const p of this.seamPoints()) seam.push(p.x, p.y)

        const build = (g: Graphics, side: -1 | 1) => {
            g.clear()
            const poly = seam.slice()
            const edge = DISC_CX + side * (DISC_R + 90)
            poly.push(edge, DISC_CY + DISC_R + 30)
            poly.push(edge, DISC_CY - DISC_R - 30)
            g.poly(poly).fill({ color: 0xffffff })
        }
        build(this.maskL, -1)
        build(this.maskR, 1)
    }

    private drawCradle(): void {
        const g = this.cradleGfx
        g.clear()
        g.rect(DISC_CX - DISC_R - 18, DISC_CY + DISC_R - 26, 26, 74).fill({ color: C.barkDark })
        g.rect(DISC_CX + DISC_R - 8, DISC_CY + DISC_R - 26, 26, 74).fill({ color: C.barkDark })
        g.rect(DISC_CX - DISC_R - 26, DISC_CY + DISC_R + 34, DISC_R * 2 + 52, 16).fill({ color: C.bark })
    }

    private paintDisc(g: Graphics): void {
        const log = this.run.log
        {
            const dx = 0
            // cradle-facing disc
            // ragged bark rim
            const rim: number[] = []
            for (let i = 0; i < 48; i++) {
                const a = (i / 48) * Math.PI * 2
                const rr = DISC_R + ((i * 41) % 7) - 3
                rim.push(DISC_CX + dx + Math.cos(a) * rr, DISC_CY + Math.sin(a) * rr)
            }
            g.poly(rim).fill({ color: C.barkDark })
            g.circle(DISC_CX + dx, DISC_CY, DISC_R - 5).fill({ color: C.bark })
            g.circle(DISC_CX + dx, DISC_CY, DISC_R - 12).fill({ color: C.woodLight })
            g.circle(DISC_CX + dx, DISC_CY, DISC_R - 20).fill({ color: C.wood })
            // growth rings, bent by the grain bias so the player can read the
            // fibre direction before the crack takes it
            const bias = log.band.grainBias
            for (let r = DISC_R - 22; r > 6; r -= 5.5) {
                const wob = bias * 26
                g.ellipse(
                    DISC_CX + dx + Math.sin(r * 0.09) * wob,
                    DISC_CY + Math.cos(r * 0.13) * wob * 0.6,
                    r,
                    r * (1 - bias * 0.16),
                ).stroke({ color: r % 11 < 5.5 ? C.ring : C.woodDark, width: 1.1, alpha: 0.55 })
            }
            // radial drying checks, the way a dry hardwood end actually splits
            for (let i = 0; i < 7; i++) {
                const a = (i / 7) * Math.PI * 2 + log.index * 0.7
                const r0 = 10 + ((i * 37) % 30)
                const r1 = r0 + 30 + ((i * 53) % 60)
                g.moveTo(DISC_CX + dx + Math.cos(a) * r0, DISC_CY + Math.sin(a) * r0)
                g.lineTo(DISC_CX + dx + Math.cos(a + 0.05) * r1, DISC_CY + Math.sin(a + 0.05) * r1)
                g.stroke({ color: C.barkDark, width: 1.4, alpha: 0.5 })
            }
            // vertical fibre lines
            for (let i = 0; i < 26; i++) {
                const fx = DISC_CX + dx - DISC_R + 8 + i * ((DISC_R * 2 - 16) / 25)
                const rel = (fx - DISC_CX - dx) / DISC_R
                const half = Math.sqrt(Math.max(0, 1 - rel * rel)) * DISC_R
                const bend = fibreAt(log.fibreNodes, (i + 0.5) / 26) * bias * 40
                g.moveTo(fx, DISC_CY - half + 4)
                g.bezierCurveTo(fx + bend, DISC_CY - half * 0.3, fx + bend, DISC_CY + half * 0.3, fx, DISC_CY + half - 4)
                g.stroke({ color: C.woodDark, width: 0.8, alpha: 0.3 })
            }
        }

        // knots: the crack kinks when it crosses one, so they are drawn where
        // they actually sit along the crack's run
        log.knots.forEach((k, ki) => {
            const ky = DISC_CY - DISC_R + k.p * DISC_R * 2
            const kx = DISC_CX + Math.sign(k.kink) * (14 + Math.abs(k.kink) * 34) + (ki % 2 ? 9 : -7)
            const tilt = k.kink * 1.6 + ki
            const rx = 15 + Math.abs(k.kink) * 10
            const ry = 9
            // the grain sweeps around a knot rather than running past it
            for (let i = 0; i < 5; i++) {
                const f = 1 - i * 0.17
                g.ellipse(kx, ky, rx * f, ry * f)
                g.stroke({ color: i % 2 ? C.barkDark : C.woodDark, width: 1.5, alpha: 0.75 })
            }
            g.ellipse(kx, ky, rx * 0.3, ry * 0.3).fill({ color: 0x2a1c11 })
            // the swirl that throws the crack off line
            g.moveTo(kx - rx * 1.5, ky - ry * 0.9)
            g.bezierCurveTo(kx - rx * 0.4, ky - ry * 1.5 - tilt, kx + rx * 0.4, ky - ry * 1.5 + tilt, kx + rx * 1.5, ky - ry * 0.9)
            g.stroke({ color: C.woodDark, width: 1.2, alpha: 0.6 })
            g.moveTo(kx - rx * 1.5, ky + ry * 0.9)
            g.bezierCurveTo(kx - rx * 0.4, ky + ry * 1.5 + tilt, kx + rx * 0.4, ky + ry * 1.5 - tilt, kx + rx * 1.5, ky + ry * 0.9)
            g.stroke({ color: C.woodDark, width: 1.2, alpha: 0.6 })
        })

        // the painted target band, physically narrowing per difficulty band
        const yNear = DISC_CY - DISC_R + bandNear(log) * DISC_R * 2
        const yFar = DISC_CY - DISC_R + bandFar(log) * DISC_R * 2
        for (let y = yNear; y < yFar; y += 2) {
            const rel = (y - DISC_CY) / DISC_R
            const half = Math.sqrt(Math.max(0, 1 - rel * rel)) * (DISC_R - 8)
            g.rect(DISC_CX - half, y, half * 2, 2).fill({ color: C.sap, alpha: 0.34 })
        }
        const relN = (yNear - DISC_CY) / DISC_R
        const halfN = Math.sqrt(Math.max(0, 1 - relN * relN)) * (DISC_R - 8)
        g.moveTo(DISC_CX - halfN, yNear).lineTo(DISC_CX + halfN, yNear).stroke({ color: C.sap, width: 1.6 })
        const relF = (yFar - DISC_CY) / DISC_R
        const halfF = Math.sqrt(Math.max(0, 1 - relF * relF)) * (DISC_R - 8)
        g.moveTo(DISC_CX - halfF, yFar).lineTo(DISC_CX + halfF, yFar).stroke({ color: C.sap, width: 1.6 })

    }

    private drawCrack(): void {
        const g = this.crackGfx
        g.clear()
        // Once the log is in two pieces the seam belongs to the halves, which
        // are moving; drawing it here as well would leave a ghost crack behind.
        if (this.splitSeamPainted) return
        if (this.crackPoints.length < 2) return
        const log = this.run.log
        if (log.outcome === 'shatter') return

        const pts = this.crackPoints
        const n = pts.length
        // The gash closes to nothing at the tip, so it reads as something being
        // driven down the log rather than a slot that was always there.
        const taperOver = Math.max(1, Math.min(14, Math.floor(n * 0.18)))
        const hw = (i: number) => pts[i].w * (0.35 + 0.65 * Math.min(1, (n - 1 - i) / taperOver))

        // the open gap, dark all the way down
        const gap: number[] = []
        for (let i = 0; i < n; i++) gap.push(pts[i].x - hw(i), pts[i].y)
        for (let i = n - 1; i >= 0; i--) gap.push(pts[i].x + hw(i), pts[i].y)
        g.poly(gap).fill({ color: 0x1c1108 })

        // Fresh end grain on each lip, drawn per grade in runs, so every
        // stroke keeps the face its own grade tore. A bite run stays a dark
        // hairline; a 정타 run above it is broad and pale. That contrast is
        // inside one frame, which is what makes the two tellable apart without
        // laying two captures side by side.
        let i0 = 0
        while (i0 < n) {
            let i1 = i0
            while (i1 + 1 < n && pts[i1 + 1].tier === pts[i0].tier) i1 += 1
            const spec = CRACK_FACE[pts[i0].tier]
            // Overlap one point back into the previous run so the faces meet.
            const a = Math.max(0, i0 - 1)
            if (spec.lip > 0 && i1 > a) {
                for (const side of [-1, 1] as const) {
                    const face: number[] = []
                    for (let i = a; i <= i1; i++) face.push(pts[i].x + side * hw(i), pts[i].y)
                    for (let i = i1; i >= a; i--) face.push(pts[i].x + side * (hw(i) + spec.lip), pts[i].y)
                    // The two sides take the low sun differently, which is what
                    // makes the gap read as having depth.
                    g.poly(face).fill({ color: side < 0 ? spec.face : spec.shade })
                }
            }
            i0 = i1 + 1
        }

        // Torn fibres along both lips. Only a face that actually opened sheds
        // them, so a bite run is bare and a 결 run is fringed hard.
        for (let i = 2; i < n; i += 3) {
            const spec = CRACK_FACE[pts[i].tier]
            if (spec.fringe <= 0) continue
            const w = hw(i)
            const len = w * (0.5 + Math.random() * 1.5) * spec.fringe
            g.moveTo(pts[i].x - w, pts[i].y).lineTo(pts[i].x - w - len, pts[i].y + (Math.random() - 0.5) * 4)
            g.moveTo(pts[i].x + w, pts[i].y).lineTo(pts[i].x + w + len, pts[i].y + (Math.random() - 0.5) * 4)
            g.stroke({ color: C.freshDeep, width: 0.9, alpha: 0.85 })
        }

        // the running tip
        const tip = pts[n - 1]
        g.circle(tip.x, tip.y, Math.max(2, tip.w * 0.55)).fill({ color: C.fresh, alpha: 0.9 })
    }

    private drawShards(): void {
        const g = this.shardGfx
        g.clear()
        for (const s of this.shards) {
            const c = Math.cos(s.rot), sn = Math.sin(s.rot)
            const out: number[] = []
            for (let i = 0; i < s.pts.length; i += 2) {
                const x = s.pts[i], y = s.pts[i + 1]
                out.push(s.x + x * c - y * sn, s.y + x * sn + y * c)
            }
            g.poly(out).fill({ color: C.wood })
            // The piece keeps the growth rings and the bark it broke off with,
            // so a shattered log is still the same wood, just in bits.
            const map = (lx: number, ly: number) => [s.x + lx * c - ly * sn, s.y + lx * sn + ly * c] as const
            for (let rr = s.r * 0.28; rr < s.r; rr += 5.5) {
                const arc: number[] = []
                for (let k = 0; k <= 6; k++) {
                    const a = s.a0 + ((s.a1 - s.a0) * k) / 6
                    const q = map(Math.cos(a) * rr, Math.sin(a) * rr)
                    arc.push(q[0], q[1])
                }
                g.poly(arc, false).stroke({ color: rr % 11 < 5.5 ? C.ring : C.woodDark, width: 1.1, alpha: 0.6 })
            }
            // bark along the outer edge
            const bark: number[] = []
            for (let k = 0; k <= 6; k++) {
                const a = s.a0 + ((s.a1 - s.a0) * k) / 6
                const q = map(Math.cos(a) * s.r * 0.97, Math.sin(a) * s.r * 0.97)
                bark.push(q[0], q[1])
            }
            g.poly(bark, false).stroke({ color: C.barkDark, width: 4, alpha: 0.85 })
            // the freshly broken faces
            g.poly(out).stroke({ color: C.fresh, width: 2 })
        }
    }

    /** The run so far, split and ruined together. Never cleared. */
    private drawPile(): void {
        const g = this.pileGfx
        g.clear()
        const baseY = PLAY_BOTTOM - 8
        this.run.pile.forEach((entry, i) => {
            const x = 5
            const y = baseY - i * 21
            if (entry.outcome === 'split') {
                // a clean half billet
                g.poly([x, y, x + 22, y, x + 19, y - 17, x + 3, y - 17]).fill({ color: C.wood })
                g.poly([x + 3, y - 17, x + 19, y - 17, x + 17, y - 12, x + 5, y - 12]).fill({ color: C.fresh })
                if (entry.grain) {
                    // grain mark: the log gave way along its own grain
                    g.moveTo(x + 11, y - 16).lineTo(x + 11, y - 1).stroke({ color: C.sap, width: 1.8 })
                }
            } else {
                // ruined: jagged, and it stays on the pile
                g.poly([x, y, x + 22, y, x + 16, y - 9, x + 20, y - 15, x + 9, y - 11, x + 4, y - 16])
                    .fill({ color: C.woodDark })
                g.poly([x + 4, y - 16, x + 9, y - 11, x + 20, y - 15]).fill({ color: C.freshDeep })
            }
        })
    }

    /** Three physical wedges beside the cradle. One snaps per failure. */
    private drawBudget(): void {
        const g = this.budgetGfx
        g.clear()
        const baseY = DISC_CY + DISC_R + 86
        for (let i = 0; i < FAILURE_BUDGET; i++) {
            const x = 72 + i * 22
            const broken = i < this.run.failures
            const shakeY = broken && this.wedgeSnapAnim > 0 && i === this.run.failures - 1
                ? (Math.random() - 0.5) * 3 : 0
            if (!broken) {
                g.poly([x, baseY, x + 12, baseY, x + 7, baseY - 46, x + 5, baseY - 46]).fill({ color: C.iron })
                g.poly([x + 5, baseY - 46, x + 7, baseY - 46, x + 8, baseY]).fill({ color: C.ironLight, alpha: 0.5 })
            } else {
                // snapped: a short stump left standing, the broken top lying flat
                // beside it. Read by shape, not by colour.
                g.poly([x, baseY + shakeY, x + 12, baseY + shakeY, x + 9, baseY - 15, x + 3, baseY - 18])
                    .fill({ color: C.ironDark })
                g.poly([x + 1, baseY - 18, x + 9, baseY - 15, x + 6, baseY - 11])
                    .fill({ color: C.ironLight, alpha: 0.35 })
                g.poly([x - 3, baseY - 3, x + 13, baseY - 7, x + 14, baseY - 2, x - 2, baseY + 2])
                    .fill({ color: C.ironDark })
            }
        }
    }

    private drawWedgeAndRing(): void {
        const wg = this.wedgeGfx
        const rg = this.ringGfx
        wg.clear()
        rg.clear()
        const log = this.run.log
        if (this.phase !== 'play' || log.outcome !== null) return

        // The wedge does not ride the recoil; it waits, and the log comes up to
        // meet it. `topY` is the log's top face where it is right now.
        const topY = DISC_CY - DISC_R + this.logBobY()
        const restY = DISC_CY - DISC_R - BOB - 40
        const wx = DISC_CX

        // --- the strike: plunge into the log, seat, then lift back out
        let wedgeY = restY
        let tilt = 0
        if (this.strike) {
            // How deep the wedge seats is the same ladder again: a bite stands
            // proud of the face, a true strike buries most of the wedge.
            const seat = STRIKE_FEEL[this.strike.tier].seat
            const deepY = topY + seat
            const t = 1 - this.strike.ms / this.strike.total
            if (t < 0.16) {
                wedgeY = restY + (deepY - restY) * (t / 0.16) ** 0.55
            } else {
                const u = (t - 0.16) / 0.84
                wedgeY = deepY + (restY - deepY) * (1 - (1 - u) ** 3)
            }
            if (this.strike.kick) {
                // a bounced wedge skids off the face instead of seating
                tilt = this.strike.kick * Math.sin(t * Math.PI) * 0.5
            }
        }

        // the wedge itself
        const c = Math.cos(tilt), sn = Math.sin(tilt)
        const pt = (dx: number, dy: number) => [wx + dx * c - dy * sn, wedgeY + dx * sn + dy * c] as const
        const poly = (...pts: Array<readonly [number, number]>) => pts.flatMap((q) => [q[0], q[1]])
        wg.poly(poly(pt(-9, -44), pt(9, -44), pt(3, 0), pt(-3, 0))).fill({ color: C.iron })
        wg.poly(poly(pt(1, -44), pt(9, -44), pt(3, 0))).fill({ color: C.ironLight, alpha: 0.45 })
        wg.poly(poly(pt(-11, -49), pt(11, -49), pt(11, -44), pt(-11, -44))).fill({ color: C.ironDark })

        // the ring: open exactly while the tap would succeed, inner solid arc
        // marks the precision window, and it visibly thins as they narrow
        const err = currentErrorMs(log)
        const win = log.band.successWindowMs
        // Before the first tap the recoil is frozen at the peak, so the ring
        // is shown open: that is the moment the guide is pointing at.
        const open = !this.run.started || Math.abs(err) <= win
        const ringR = 30
        const cy = restY - 22
        const thick = 1.6 + (win / 140) * 3.6
        rg.circle(wx, cy, ringR).stroke({ color: open ? C.sap : C.sapDim, width: thick, alpha: open ? 0.95 : 0.28 })
        const innerFrac = log.band.precisionWindowMs / win
        const innerR = ringR - thick - 2.5
        const a0 = -Math.PI / 2 - Math.PI * innerFrac
        const a1 = -Math.PI / 2 + Math.PI * innerFrac
        // moveTo first: arc() continues the current path, and without this the
        // renderer draws a leader line in from wherever the pen was.
        rg.moveTo(wx + Math.cos(a0) * innerR, cy + Math.sin(a0) * innerR)
        rg.arc(wx, cy, innerR, a0, a1)
            .stroke({ color: C.sap, width: 2.4, alpha: open ? 1 : 0.35 })

        // sticky correction tick from the last strike: direction and size
        if (log.lastTap) {
            const frac = Math.max(-1, Math.min(1, log.lastTap.errorMs / win))
            const a = -Math.PI / 2 + frac * Math.PI * 0.92
            rg.moveTo(wx + Math.cos(a) * (ringR - 6), cy + Math.sin(a) * (ringR - 6))
            rg.lineTo(wx + Math.cos(a) * (ringR + 8), cy + Math.sin(a) * (ringR + 8))
            rg.stroke({ color: C.text, width: 2.2 })
        }
    }

    private drawDust(): void {
        const g = this.dustGfx
        g.clear()
        for (const d of this.dust) {
            const a = 1 - d.life / d.max
            g.rect(d.x, d.y, d.size, d.size * 0.8).fill({ color: C.dust, alpha: a * 0.85 })
        }
    }

    /**
     * Say the grade out loud, in the current language, while it is happening.
     *
     * This is the whole point of the grade ladder: a player who reads only
     * "빠름 -116ms" learns that they were early, but not that being early by
     * that much is called 물림 and that 정타 and 결 sit above it. The name pops
     * on the strike and then holds for the rest of the log so the reaction and
     * its name are never on screen apart from each other.
     */
    private drawGrade(tier: Tier | null): void {
        const show = this.phase === 'play' && tier !== null
        this.gradeText.visible = show
        for (const t of this.ladderTexts) t.visible = show
        if (!show || !tier) return

        const pop = this.gradeAnim / GRADE_POP_MS // 1 right after the strike, 0 once settled
        this.gradeText.text = gradeLabel(this.lang, tier)
        this.gradeText.style.fill = TIER_COLOR[tier]
        this.gradeText.scale.set(1 + 0.3 * pop * pop)
        this.gradeText.alpha = 0.82 + 0.18 * pop

        // The rungs, laid out centred. Widths differ per language, so they are
        // measured rather than assumed.
        const gap = 12
        const widths: number[] = []
        for (let i = 0; i < TIER_LADDER.length; i++) {
            const rung = TIER_LADDER[i]
            const t = this.ladderTexts[i]
            t.text = gradeLabel(this.lang, rung)
            const lit = rung === tier
            t.style.fill = lit ? TIER_COLOR[rung] : C.textDim
            t.alpha = lit ? 1 : 0.45
            t.scale.set(lit ? 1.15 : 1)
            widths.push(t.width)
        }
        const total = widths.reduce((a, b) => a + b, 0) + gap * (TIER_LADDER.length - 1)
        let x = DISC_CX - total / 2
        for (let i = 0; i < this.ladderTexts.length; i++) {
            this.ladderTexts[i].position.set(x + widths[i] / 2, LADDER_Y)
            x += widths[i] + gap
        }
    }

    private drawHud(): void {
        const s = strings(this.lang)
        const log = this.run.log
        this.counterText.text = this.phase === 'play' ? s.logCounter(log.index, TOTAL_LOGS) : ''
        this.counterText.visible = this.phase === 'play'
        for (const t of this.ctrlTexts) t.visible = this.phase === 'play'
        this.refreshCtrlGlyphs()

        // The grade, called by its name, during play. It appears on the strike
        // that fired it and stays for the rest of the log, resolution included,
        // so the word is on screen at the same moment as the reaction it names.
        this.drawGrade(log.lastTap?.tier ?? null)

        // Always-on correction cue: direction and magnitude, in the player's
        // words. Held through the resolution as well, so the number that
        // explains the grade is still there while the log comes apart.
        if (this.phase === 'play' && log.lastTap) {
            const e = Math.round(log.lastTap.errorMs)
            const dir = e < 0 ? s.early : s.late
            this.cueText.text = `${dir} ${e > 0 ? '+' : ''}${e}ms`
            this.cueText.position.set(DISC_CX + 44, DISC_CY - DISC_R - BOB - 62)
            this.cueText.visible = true
        } else {
            this.cueText.visible = false
        }

        // Only on the first log: where "now" is.
        const firstLog = this.run.log.index === 1 && this.run.splits === 0 && this.run.failures === 0
        if (this.phase === 'play' && firstLog && log.outcome === null) {
            this.nowText.text = s.now
            this.nowText.position.set(DISC_CX, DISC_CY - DISC_R - BOB - 40 - 22 + 46)
            this.nowText.visible = true
        } else {
            this.nowText.visible = false
        }

        // Failure frame: how far off, which way, and which band it happened in.
        // Stays on screen through the whole resolution, so two attempts read
        // differently instead of looking identical.
        const f = this.run.lastFailure
        // The frozen crack keeps its distance readout through the resolution AND
        // into the final scene, so the last thing on screen says how far off it
        // stopped and in which band. Two attempts must never look identical.
        const showFailure = Boolean(f) && log.outcome !== null && log.outcome !== 'split'
            && (this.phase === 'play' || this.phase === 'over')
        if (showFailure && f) {
            const pct = Math.round(Math.abs(f.delta) * 100)
            const word = f.outcome === 'shatter' ? s.over : s.short
            this.failText.text = `${pct}% ${word} · ${s.bandReached(f.bandIndex)}`
            this.failText.position.set(DISC_CX, DISC_CY + DISC_R + 12)
            this.failText.visible = true
            this.drawFailureArrow(f.outcome, f.delta)
        } else {
            this.failText.visible = false
            this.markerGfx.clear()
        }
    }

    private refreshCtrlGlyphs(): void {
        this.ctrlTexts[0].text = this.paused ? '>' : '||'
        this.ctrlTexts[1].text = sound.isMuted() ? 'x)' : '(*'
        this.ctrlTexts[2].text = this.lang === 'ko' ? 'EN' : '한'
    }

    /** Arrow between the stopped crack tip and the band edge it missed. */
    private drawFailureArrow(outcome: 'shatter' | 'short', delta: number): void {
        const g = this.markerGfx
        g.clear()
        const log = this.run.log
        const tipY = DISC_CY - DISC_R + log.crackP * DISC_R * 2
        const edgeY = outcome === 'shatter'
            ? DISC_CY - DISC_R + bandFar(log) * DISC_R * 2
            : DISC_CY - DISC_R + bandNear(log) * DISC_R * 2
        // Draw the gap where it actually is: alongside the stopped crack tip,
        // spanning tip to band edge, so the number and the picture agree.
        const tip = this.crackPoints[this.crackPoints.length - 1]
        const x = Math.max(DISC_CX - DISC_R + 26, Math.min(DISC_CX + DISC_R - 26, (tip?.x ?? DISC_CX) + 26))
        g.moveTo(x, tipY)
        g.lineTo(x, edgeY)
        g.stroke({ color: C.text, width: 2 })
        const head = (y: number, dir: 1 | -1, color: number) => {
            g.moveTo(x - 5, y + dir * 6)
            g.lineTo(x, y)
            g.lineTo(x + 5, y + dir * 6)
            g.stroke({ color, width: 2 })
        }
        head(tipY, edgeY > tipY ? -1 : 1, C.text)
        head(edgeY, edgeY > tipY ? 1 : -1, C.sap)
        // tie the arrow back to the crack tip
        if (tip) {
            g.moveTo(tip.x, tipY)
            g.lineTo(x, tipY)
            g.stroke({ color: C.text, width: 1, alpha: 0.5 })
        }
        void delta
    }

    private drawGuide(): void {
        const show = this.phase === 'play' && this.run.guideVisible
        this.guideLayer.visible = show
        if (!show) return
        const g = this.guideLayer.children.find((c) => c instanceof Graphics) as Graphics | undefined
        const gg = g ?? new Graphics()
        if (!g) this.guideLayer.addChildAt(gg, 0)
        gg.clear()
        // Strip lives strictly below the play area, so it never covers the log.
        gg.rect(0, PLAY_BOTTOM, W, H - PLAY_BOTTOM).fill({ color: C.panel, alpha: 0.94 })
        gg.moveTo(0, PLAY_BOTTOM).lineTo(W, PLAY_BOTTOM).stroke({ color: C.bark, width: 2 })
    }

    private drawOverlays(): void {
        this.overlayLayer.removeChildren()
        const s = strings(this.lang)

        if (this.phase === 'title') {
            const g = new Graphics()
            g.rect(0, 0, W, H).fill({ color: C.panel })
            this.overlayLayer.addChild(g)
            if (this.titleTexture) {
                const sp = new Sprite(this.titleTexture)
                const sc = Math.max(W / sp.texture.width, (H * 0.62) / sp.texture.height)
                sp.scale.set(sc)
                sp.anchor.set(0.5, 0)
                sp.position.set(W / 2, 92)
                this.overlayLayer.addChild(sp)
                const fade = new Graphics()
                fade.rect(0, 92, W, 60).fill({ color: C.panel, alpha: 0.75 })
                fade.rect(0, H * 0.62, W, H - H * 0.62).fill({ color: C.panel, alpha: 0.8 })
                this.overlayLayer.addChild(fade)
            }
            const title = new Text({ text: s.titleName, style: font(38, C.fresh, true) })
            title.anchor.set(0.5)
            title.position.set(W / 2, 60)
            const hint = new Text({ text: s.titleStart, style: font(16, C.sap, true) })
            hint.anchor.set(0.5)
            hint.position.set(W / 2, H - 90)
            this.overlayLayer.addChild(title, hint)
            return
        }

        if (this.paused || this.hostPaused) {
            const g = new Graphics()
            g.rect(0, 0, W, H).fill({ color: C.panel, alpha: 0.8 })
            const t = new Text({ text: s.paused, style: font(30, C.text, true) })
            t.anchor.set(0.5)
            t.position.set(W / 2, H / 2 - 16)
            const h = new Text({ text: s.resumeHint, style: font(15, C.textDim) })
            h.anchor.set(0.5)
            h.position.set(W / 2, H / 2 + 22)
            this.overlayLayer.addChild(g, t, h)
            return
        }

        if (this.phase === 'over') {
            const sum = summarize(this.run)
            const g = new Graphics()
            // Top panel: the run is unmistakably over.
            g.rect(0, 0, W, 176).fill({ color: C.panel, alpha: 0.93 })
            g.moveTo(0, 176).lineTo(W, 176).stroke({ color: C.bark, width: 2 })
            // Bottom: the restart control, written on screen.
            g.roundRect(W / 2 - 118, H - 104, 236, 62, 8).fill({ color: C.bark })
            g.roundRect(W / 2 - 118, H - 104, 236, 62, 8).stroke({ color: C.fresh, width: 2 })
            this.overlayLayer.addChild(g)

            const lines: Array<[string, number, number, boolean]> = [
                [s.endTitle(sum.splits, TOTAL_LOGS), 26, 24, true],
                [s.avgAccuracy(sum.avgAccuracy.toFixed(2)), 15, 66, false],
                [s.swing(Math.round(sum.swingMs)), 15, 90, false],
                [s.preciseTaps(sum.preciseCount), 14, 114, false],
                [s.score(sum.score.toLocaleString('en-US')), 14, 136, false],
            ]
            for (const [text, size, y, bold] of lines) {
                const t = new Text({ text, style: font(size, bold ? C.fresh : C.text, bold) })
                t.anchor.set(0.5, 0)
                t.position.set(W / 2, y)
                this.overlayLayer.addChild(t)
            }
            const rule = new Text({ text: s.grainRule, style: { ...font(11, C.sap), wordWrap: true, wordWrapWidth: W - 40, align: 'center' } })
            rule.anchor.set(0.5, 0)
            rule.position.set(W / 2, 154)
            this.overlayLayer.addChild(rule)

            const btn = new Text({ text: s.retry, style: font(24, C.fresh, true) })
            btn.anchor.set(0.5)
            btn.position.set(W / 2, H - 73)
            this.overlayLayer.addChild(btn)
        }
    }
}

// ------------------------------------------------------------------ helpers

function lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
    return (
        (Math.round(ar + (br - ar) * t) << 16)
        | (Math.round(ag + (bg - ag) * t) << 8)
        | Math.round(ab + (bb - ab) * t)
    )
}

function detectLang(): Lang {
    try {
        return (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en'
    } catch { return 'ko' }
}

// The arcade runner serves the page from its own origin, so document.baseURI
// points at the runner, not at the release. Resolve against this module's own
// URL instead, which always sits inside the release directory.
const MODULE_BASE = new URL('.', import.meta.url).href

function titleKeyUrl(): string {
    return __DISTRIBUTION__ === 'arcade' ? `${MODULE_BASE}art/title-key.jpg` : '/art/title-key.jpg'
}
