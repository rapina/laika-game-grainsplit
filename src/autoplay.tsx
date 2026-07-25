import { createRoot } from 'react-dom/client'

/**
 * Headless-verification entry: mounts the game alone with a seeded RNG so a run
 * is reproducible. Driven by scripts/smoke.mjs and scripts/viewport-smoke.mjs,
 * or open manually at /autoplay.html?seed=1. The final GameResult lands in
 * globalThis.__gameResult and live runtime state in globalThis.__gameState.
 */
const qs = new URLSearchParams(window.location.search)
const seed = qs.get('seed')
// The runtime seeds each run from this, so ?seed=N replays identically.
if (seed) (globalThis as unknown as Record<string, unknown>).__grainsplitSeed = seed

await import('./index.css')
const { default: GameScreen } = await import('./components/GameScreen')

createRoot(document.getElementById('root')!).render(<GameScreen />)
