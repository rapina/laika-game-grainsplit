/**
 * Viewport + canvas-resolution gate.
 *
 *   node scripts/viewport-smoke.mjs
 *
 * For each viewport it boots the game, drives a few real strikes, and asserts:
 *   - nothing overflows the frame and the canvas is fully inside it
 *   - the canvas keeps a uniform aspect ratio (circles stay circles)
 *   - canvas.width / CSS width AND canvas.height / CSS height are both at
 *     least max(1, devicePixelRatio) — the render scale is never pinned below
 *     the device pixel ratio
 * Captures land in verification/ and are committed as evidence.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const PORT = 4187
const OUT = 'verification'
const DESIGN = { w: 390, h: 844 }

const VIEWPORTS = [
    { name: '360x800', width: 360, height: 800, dpr: 3 },
    { name: '390x844', width: 390, height: 844, dpr: 3 },
    { name: '430x932', width: 430, height: 932, dpr: 3 },
    { name: '900x760-wide', width: 900, height: 760, dpr: 2 },
]

async function waitForServer() {
    for (let i = 0; i < 120; i++) {
        try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) return } catch { /* not up */ }
        await delay(500)
    }
    throw new Error('dev server did not start')
}

async function launchBrowser() {
    const opts = { headless: true, args: ['--disable-gpu', '--no-sandbox'] }
    if (process.env.CHROME) return chromium.launch({ ...opts, executablePath: process.env.CHROME })
    try { return await chromium.launch({ ...opts, channel: 'chrome' }) } catch { return chromium.launch(opts) }
}

const dev = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--force'], {
    stdio: 'pipe', shell: true, detached: process.platform !== 'win32',
})

let exitCode = 0
try {
    mkdirSync(OUT, { recursive: true })
    await waitForServer()
    const browser = await launchBrowser()
    const captures = []
    const report = { design: DESIGN, viewports: [] }

    for (const vp of VIEWPORTS) {
        const page = await browser.newPage({
            viewport: { width: vp.width, height: vp.height },
            deviceScaleFactor: vp.dpr,
        })
        const errors = []
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
        page.on('pageerror', (e) => errors.push(String(e)))

        await page.goto(`http://127.0.0.1:${PORT}/autoplay.html?seed=5`, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('canvas', { timeout: 30000 })
        await delay(1200)

        // start the run and land a few strikes so the frame is not just a title
        const box0 = await page.locator('canvas').boundingBox()
        const click = () => page.mouse.click(box0.x + box0.width / 2, box0.y + box0.height * 0.55)
        await click(); await delay(700)
        for (let i = 0; i < 60; i++) {
            const st = await page.evaluate(() => globalThis.__gameState)
            if (st?.over) break
            if (st?.ringOpen) { await click(); await delay(300) }
            await delay(20)
        }

        const m = await page.evaluate(() => {
            const c = document.querySelector('canvas')
            const r = c.getBoundingClientRect()
            return {
                bufferW: c.width, bufferH: c.height,
                cssW: r.width, cssH: r.height,
                left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                dpr: window.devicePixelRatio,
                docScrollW: document.documentElement.scrollWidth,
                docScrollH: document.documentElement.scrollHeight,
                innerW: window.innerWidth, innerH: window.innerHeight,
            }
        })

        const need = Math.max(1, m.dpr)
        const ratioW = m.bufferW / m.cssW
        const ratioH = m.bufferH / m.cssH
        const aspect = (m.cssW / m.cssH) / (DESIGN.w / DESIGN.h)
        const checks = {
            dprWidthOk: ratioW >= need - 1e-6,
            dprHeightOk: ratioH >= need - 1e-6,
            uniformAspect: Math.abs(aspect - 1) < 0.01,
            insideFrame: m.left >= -0.5 && m.top >= -0.5 && m.right <= m.innerW + 0.5 && m.bottom <= m.innerH + 0.5,
            noPageOverflow: m.docScrollW <= m.innerW + 1 && m.docScrollH <= m.innerH + 1,
            noErrors: errors.length === 0,
        }
        const pass = Object.values(checks).every(Boolean)
        if (!pass) exitCode = 1

        captures.push({ path: `${OUT}/viewport-${vp.name}.png`, buffer: await page.screenshot() })
        report.viewports.push({
            ...vp,
            bufferW: m.bufferW, bufferH: m.bufferH, cssW: m.cssW, cssH: m.cssH,
            devicePixelRatio: m.dpr,
            canvasWidthOverCssWidth: Number(ratioW.toFixed(4)),
            canvasHeightOverCssHeight: Number(ratioH.toFixed(4)),
            requiredRatio: need,
            aspectRatioVsDesign: Number(aspect.toFixed(5)),
            errors,
            checks,
            pass,
        })
        await page.close()
    }

    await browser.close()
    report.pass = report.viewports.every((v) => v.pass)
    const json = JSON.stringify(report, null, 2)
    // The sky embers and the title pulse animate, so capture bytes differ on
    // every run. Only rewrite the evidence when the measured result actually
    // changes, otherwise the publish gate's clean-repo check can never pass.
    const previous = existsSync(`${OUT}/viewport-result.json`)
        ? readFileSync(`${OUT}/viewport-result.json`, 'utf-8')
        : null
    if (previous !== json) {
        writeFileSync(`${OUT}/viewport-result.json`, json, 'utf-8')
        for (const { path, buffer } of captures) writeFileSync(path, buffer)
    }
    console.log(json)
    console.error(report.pass ? 'VIEWPORT OK' : 'FAIL: viewport / canvas resolution gate')
    if (!report.pass) exitCode = 1
} finally {
    try { process.kill(-dev.pid, 'SIGKILL') } catch { try { dev.kill('SIGKILL') } catch { /* gone */ } }
}
process.exit(exitCode)
