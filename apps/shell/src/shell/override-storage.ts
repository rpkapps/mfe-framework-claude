/**
 * The one place in the shell that touches Web Storage directly.
 *
 * Developer overrides have to be readable *before* the runtime exists, so they
 * cannot go through the framework storage boundary the way everything else
 * does. `createMfeRuntime` reads the documented key itself and reports every
 * malformed value as a diagnostic; the shell only hands it the storage object.
 * This file is the documented opt-out listed in the lint configuration's
 * `storageAllowedScopes`.
 */

/**
 * Reading `window.localStorage` *throws* when storage is blocked for the origin
 * (private mode, a locked-down enterprise profile), before any `getItem` call
 * the runtime could catch. Boot has to survive that: no overrides is a state
 * the shell handles, no shell is not.
 */
export function overrideStorage(): Pick<Storage, 'getItem'> | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
