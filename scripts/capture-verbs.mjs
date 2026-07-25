/**
 * Verification captures.
 *
 *   node scripts/capture-verbs.mjs
 *
 * The driver lives inside the page so it runs at frame rate, and it strikes by
 * dispatching a real pointerdown on the canvas: the same path a finger takes,
 * at the real wall clock. It chooses WHEN to strike from the rendered readouts
 * only (the ring and the error cue), never by stepping the engine itself.
 *
 * Writes into verification/: first-play, verb-<grade> for all four grades, a
 * failure frame, game-over, language, pause and mute captures, plus
 * capture-result.json describing what each frame shows.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const PORT = 4189
const OUT = 'verification'

async function waitForServer() {
    for (let i = 0; i < 120; i++) {
        try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) return } catch { /* not up */ }
        await delay(500)
    }
    throw new Error('dev server did not start')
}

const DRIVER = `
window.__drv = {
  tap() {
    const c = document.querySelector('canvas')
    const r = c.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height * 0.55
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }))
  },
  state() { return globalThis.__gameState },
  // Wait until \`test(state)\` is true, then strike. Polls on rAF, so the wait
  // costs nothing and the strike lands at the frame the condition held.
  strikeWhen(testSrc, timeoutMs = 12000) {
    const test = new Function('s', 'return (' + testSrc + ')(s)')
    return new Promise((resolve) => {
      const t0 = performance.now()
      const loop = () => {
        const s = globalThis.__gameState
        if (!s || s.over || performance.now() - t0 > timeoutMs) return resolve(null)
        if (test(s)) { window.__drv.tap(); return setTimeout(() => resolve(globalThis.__gameState), 60) }
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
  },
  // Poll on rAF until the rendered reaction reaches \`test\`, so a capture is
  // timed off what is actually on screen. Fixed delays cannot do this job: a
  // round trip out to the driver costs a few hundred milliseconds, which is a
  // large fraction of a resolution, and the frame is gone by the time it lands.
  waitFor(testSrc, timeoutMs = 3000) {
    const test = new Function('s', 'return (' + testSrc + ')(s)')
    return new Promise((resolve) => {
      const t0 = performance.now()
      const loop = () => {
        const s = globalThis.__gameState
        if (!s || performance.now() - t0 > timeoutMs) return resolve(null)
        if (test(s)) return resolve(s)
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
  },
  playOut(timeoutMs = 120000) {
    return new Promise((resolve) => {
      const t0 = performance.now()
      let last = 0
      const loop = () => {
        const s = globalThis.__gameState
        if (!s || s.over || performance.now() - t0 > timeoutMs) return resolve(globalThis.__gameState)
        if (s.ringOpen && performance.now() - last > 260) { window.__drv.tap(); last = performance.now() }
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
  },
}
`

const dev = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--force'], {
    stdio: 'pipe', shell: true, detached: process.platform !== 'win32',
})

let code = 0
try {
    mkdirSync(OUT, { recursive: true })
    await waitForServer()
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-gpu', '--no-sandbox'] })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://127.0.0.1:${PORT}/autoplay.html?seed=11`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('canvas', { timeout: 30000 })
    await delay(1400)
    await page.addScriptTag({ content: DRIVER })

    const state = () => page.evaluate(() => globalThis.__gameState)
    const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` })
    const tap = () => page.evaluate(() => window.__drv.tap())
    const strikeWhen = (src, t) => page.evaluate(([s, ms]) => window.__drv.strikeWhen(s, ms), [src, t ?? 12000])
    const waitFor = (src, t) => page.evaluate(([s, ms]) => window.__drv.waitFor(s, ms), [src, t ?? 3000])

    const captured = {}
    await shot('title')
    captured.title = 'title card, generated key image, tap to start'

    await tap(); await delay(700)
    // The first-play frame: guide up, recoil still frozen, nothing struck yet.
    await shot('first-play')
    captured['first-play'] = await state()

    // The next tap unfreezes the recoil (it costs no tap budget by design).
    await tap(); await delay(400)

    // One capture per judgment grade. The condition is written against the
    // rendered error readout, which is the number printed on screen.
    const log = (m) => console.error(`[capture] ${m}`)
    const targets = [
        ['miss', 's => Math.abs(s.errorMs) > 175 && Math.abs(s.errorMs) < 260'],
        ['grain', 's => Math.abs(s.errorMs) <= 12'],
        ['precise', 's => Math.abs(s.errorMs) > 20 && Math.abs(s.errorMs) <= 40'],
        ['bite', 's => Math.abs(s.errorMs) > 70 && Math.abs(s.errorMs) <= 120'],
    ]
    const got = {}
    for (let round = 0; round < 22; round++) {
        const pending = targets.filter(([t]) => !got[t])
        if (!pending.length) break
        const st = await state()
        if (!st || st.over) break
        log(`round ${round} need=${pending.map((p) => p[0]).join(',')} log=${st.logIndex} failures=${st.failures}`)
        for (const [tier, src] of pending) {
            const after = await strikeWhen(src, 3500)
            if (!after) { log(`  ${tier}: no strike landed`); continue }
            log(`  aimed ${tier}, got ${after.lastTapTier} at ${after.lastTapErrorMs}ms`)
            const landed = after.lastTapTier
            // 결 is by definition the tap that lands the split, so its capture
            // is the log coming apart. The lower grades have to show their own
            // reaction — how far this one strike drove the crack — so a tap
            // that happened to finish the log is not used for them.
            const usable = landed === 'grain' || after.outcome === null
            if (landed && !got[landed] && usable) {
                // Capture the material reaction, not the input. A crack advance
                // is torn fully open in a few frames, but a log that gives way
                // keeps coming apart for most of a second, so wait for the two
                // halves to be off the cradle before the shutter.
                const at = after.outcome === 'split'
                    ? await waitFor('s => s.splitOpen >= 0.8 || s.outcome === null', 2500)
                    : await waitFor(`s => s.crackDrawnP >= ${after.crackP - 0.002}`, 1200)
                await shot(`verb-${landed}`)
                got[landed] = at ?? after
                captured[`verb-${landed}`] = at ?? after
            }
            const now = await state()
            if (!now || now.over) break
        }
    }

    // The grade has to be called by its name ON SCREEN, DURING PLAY, in both
    // languages. Strike once per locale and photograph the frame the reaction
    // settles on, timed off the rendered state through waitFor. A fixed delay
    // would overshoot the resolution and photograph the next log, which is how
    // this defect got past review before.
    const gradeFrames = {}
    for (const locale of ['ko', 'en']) {
        const st0 = await state()
        if (!st0 || st0.over) break
        if (st0.lang !== locale) {
            await page.keyboard.press('l')
            await waitFor(`s => s.lang === '${locale}'`, 2000)
        }
        const after = await strikeWhen('s => Math.abs(s.errorMs) <= 60', 4500)
        if (!after) { log(`grade-name-${locale}: no strike landed`); continue }
        const at = await waitFor(
            `s => s.outcome !== null || s.crackDrawnP >= ${after.crackP - 0.002}`, 1800,
        )
        await shot(`grade-name-${locale}`)
        const frame = at ?? (await state())
        gradeFrames[locale] = frame
        captured[`grade-name-${locale}`] = frame
        log(`grade-name-${locale}: label=${frame?.gradeLabel} shown=${frame?.gradeShown} ladder=${(frame?.gradeLadder ?? []).join('/')}`)
    }
    const backTo = await state()
    if (backTo && backTo.lang !== 'ko') { await page.keyboard.press('l'); await waitFor("s => s.lang === 'ko'", 2000) }

    // A failure frame with its distance readout, whichever failure comes first.
    for (let i = 0; i < 25; i++) {
        const st = await state()
        if (!st || st.over) break
        if (st.failures > 0) { await shot('failure-frame'); captured['failure-frame'] = st; log('failure frame captured'); break }
        await strikeWhen('s => Math.abs(s.errorMs) > 200', 3500)
    }

    // Guide exposure: still up before two successes.
    const beforeGuide = await state()
    captured['guide-state'] = { guideVisible: beforeGuide?.guideVisible, splits: beforeGuide?.splits }

    log('playing out the run')
    const finalState = await page.evaluate(() => window.__drv.playOut(90000))
    await delay(1000)
    await shot('game-over')
    captured['game-over'] = finalState
    captured['game-over-result'] = await page.evaluate(() => globalThis.__gameResult ?? null)

    await page.keyboard.press('l'); await delay(500); await shot('game-over-en')
    captured['lang-en'] = await state()
    await page.keyboard.press('l'); await delay(300)

    // Restart with the on-screen control, then pause and mute.
    await page.keyboard.press('r'); await delay(900)
    await page.evaluate(() => window.__drv.strikeWhen('s => true', 4000))
    await delay(400)
    await page.keyboard.press('p'); await delay(500); await shot('paused')
    captured.paused = await state()
    await page.keyboard.press('p'); await delay(300)
    await page.keyboard.press('m'); await delay(400); await shot('muted')
    captured.muted = await state()

    await browser.close()
    const missing = ['miss', 'bite', 'precise', 'grain'].filter((t) => !got[t])

    // Was the grade named on screen, in play, in each language? Checked, not
    // assumed: gradeLabel/gradeShown are what the runtime actually painted in
    // the captured frame.
    const gradeNaming = {}
    for (const locale of ['ko', 'en']) {
        const f = gradeFrames[locale]
        gradeNaming[locale] = {
            shown: Boolean(f?.gradeShown),
            label: f?.gradeLabel ?? null,
            ladder: f?.gradeLadder ?? [],
            phase: f?.phase ?? null,
            tier: f?.lastTapTier ?? null,
        }
    }
    // Every grade capture must carry the grade's name too, not just its reaction.
    const unnamedGrades = Object.entries(got)
        .filter(([, f]) => !f?.gradeShown || !f?.gradeLabel)
        .map(([t]) => t)
    const unnamedLocales = ['ko', 'en'].filter(
        (l) => !gradeNaming[l].shown || !gradeNaming[l].label || gradeNaming[l].phase !== 'play',
    )

    const report = { captured, errors, missingGrades: missing, gradeNaming, unnamedGrades, unnamedLocales }
    writeFileSync(`${OUT}/capture-result.json`, JSON.stringify(report, null, 2), 'utf-8')
    console.log(JSON.stringify(report, null, 2))
    if (errors.length) { console.error('FAIL: console/page errors'); code = 1 }
    if (missing.length) { console.error('MISSING GRADES: ' + missing.join(', ')); code = 1 }
    if (unnamedGrades.length) { console.error('GRADE NOT NAMED ON SCREEN: ' + unnamedGrades.join(', ')); code = 1 }
    if (unnamedLocales.length) { console.error('GRADE NOT NAMED IN LOCALE: ' + unnamedLocales.join(', ')); code = 1 }
} finally {
    try { process.kill(-dev.pid, 'SIGKILL') } catch { try { dev.kill('SIGKILL') } catch { /* gone */ } }
}
process.exit(code)
