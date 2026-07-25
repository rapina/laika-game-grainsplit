/**
 * Claude Code Stop-hook gate: blocks the agent from finishing its turn while
 * the unit tests are red. Wired in .claude/settings.json.
 *
 * Exit codes (Stop-hook protocol):
 *   0 — allow stop (tests green, or environment not ready to run them)
 *   2 — block stop; stderr is fed back to the agent as the reason
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Respect the loop guard: when a previous Stop hook already blocked this turn,
// stop_hook_active is true — never block twice in a row.
try {
    const input = JSON.parse(readFileSync(0, 'utf-8'))
    if (input.stop_hook_active) process.exit(0)
} catch { /* no stdin payload — fine */ }

// Fresh clone without dependencies: nothing to gate.
if (!existsSync('node_modules/vitest')) process.exit(0)

const result = spawnSync('npx vitest run --reporter=dot', {
    shell: true,
    encoding: 'utf-8',
    timeout: 120_000,
})

if (result.status === 0) process.exit(0)

const tail = (s) => (s || '').split(/\r?\n/).slice(-40).join('\n')
console.error('[test-gate] vitest failed — fix the failing tests before finishing.\n')
console.error(tail(result.stdout))
console.error(tail(result.stderr))
process.exit(2)
