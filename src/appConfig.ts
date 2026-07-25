/**
 * Per-game configuration.
 *
 * `scripts/new-game.js` rewrites STORAGE_PREFIX along with the app identity;
 * everything else is edited by hand (or by an agent) when building a new game.
 */

/** localStorage key prefix. Set once per game and never change after release —
 *  changing it orphans every player's records/settings/entitlements. */
export const STORAGE_PREFIX = 'grainsplit'

export const APP_CONFIG = {
    /** Logical design resolution of the game stage. Matches game.manifest.json. */
    designWidth: 390,
    designHeight: 844,
}
