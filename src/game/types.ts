/**
 * Contract between the React shell and a game runtime.
 *
 * The shell (GameScreen / App) owns: mounting, HUD chrome, ads, platform
 * integration, records and the ranking screen.
 * The runtime owns: rendering, input, game rules and scorekeeping.
 *
 * To build a new game: implement GameRuntime in src/game/<YourGame>.ts and
 * swap the constructor call in components/GameScreen.tsx.
 */

export interface GameResult {
    /** Final score — saved to local records and the platform leaderboard. */
    score: number
    /** Stage / level / round reached. Shown on the ranking screen; 0 if meaningless. */
    phase: number
}

export interface GameCallbacks {
    /** Fired once when the run ends. The shell then moves to the ranking screen. */
    onGameOver(result: GameResult): void
}

export interface GameRuntime {
    /** Create the canvas inside `container` and start the game loop. */
    mount(container: HTMLElement, callbacks: GameCallbacks): Promise<void>

    /** Tear down canvas, listeners and timers. Must be safe to call twice. */
    destroy(): void

    /**
     * Snapshot of internal state for debugging and automated verification.
     * GameScreen exposes it as `globalThis.__gameState`; scripts/smoke.mjs
     * polls it until `over` is true. Include at least { over, score }.
     */
    getDebugState(): Record<string, unknown>
}
