// The arcade portal ships a CSP without 'unsafe-eval'; PixiJS needs this
// module to build its shader programs without eval.
import 'pixi.js/unsafe-eval'
import { GrainsplitGame } from './game/GrainsplitGame'
import { STORAGE_PREFIX } from './appConfig'
import './index.css'

/**
 * Arcade embed entry (contract-v1). STORAGE_PREFIX is the game slug, which
 * doubles as the bridge gameId.
 *
 * The runner iframe is sandboxed without allow-same-origin: never touch
 * localStorage outside a try/catch on this code path.
 */
type Locale = 'ko' | 'en'
type HostEvent = 'ready' | 'started' | 'ended'
interface Options {
    root: HTMLElement
    assetBaseUrl: string
    locale?: Locale
    seed?: string
    host: { emit(event: { contractVersion: 1; gameId: string; sequence: number; type: HostEvent; payload?: Record<string, unknown> }): void }
}

export function mountGame(options: Options) {
    let sequence = 0
    let run = 1
    let destroyed = false
    const emit = (type: HostEvent, payload?: Record<string, unknown>) => options.host.emit({
        contractVersion: 1,
        gameId: STORAGE_PREFIX,
        sequence: ++sequence,
        type,
        ...(payload ? { payload } : {}),
    })
    const shell = document.createElement('div')
    shell.className = 'screen game-screen'
    const host = document.createElement('div')
    host.className = 'game-host'
    shell.appendChild(host)
    options.root.appendChild(shell)
    const game = new GrainsplitGame()
    void game.mount(host, {
        onGameOver: (result) => emit('ended', { runId: String(run), result }),
    }).then(() => {
        if (destroyed) return
        // The host owns the locale in the arcade — hide any in-game switcher.
        host.querySelector<HTMLElement>('[data-action="lang"]')?.setAttribute('hidden', '')
        emit('ready')
        emit('started', { runId: String(run) })
    })
    const debugPoll = window.setInterval(() => {
        ;(globalThis as unknown as Record<string, unknown>).__gameState = game.getDebugState()
    }, 100)
    return {
        pause() { (game as { setPaused?(v: boolean): void }).setPaused?.(true) },
        resume() { (game as { setPaused?(v: boolean): void }).setPaused?.(false) },
        mute(value: boolean) { (game as { setMuted?(v: boolean): void }).setMuted?.(value) },
        setLocale(locale: Locale) { (game as { setLocale?(l: Locale): void }).setLocale?.(locale) },
        restart() { run += 1; (game as { restartRun?(): void }).restartRun?.(); emit('started', { runId: String(run) }) },
        destroy() { destroyed = true; clearInterval(debugPoll); game.destroy(); shell.remove() },
    }
}
