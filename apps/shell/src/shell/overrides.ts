/**
 * The developer overrides, from the side that removes them.
 *
 * `boot.tsx` reads them before any store exists, which is why that file is
 * named in the storage rule's allowed scopes. Clearing one is the same fact
 * from the other end — the key belongs to the shell's own bootstrap, not to any
 * definition's namespaced storage — so it lives beside the read rather than
 * being written inline in whichever component happened to offer the button.
 */

import { OVERRIDES_STORAGE_KEY } from '@company/mfe-host'

/**
 * Removes every override. Returns false when the browser refuses storage for
 * this origin, so the caller can say so instead of claiming it worked.
 */
export function clearOverrides(): boolean {
  try {
    window.localStorage.removeItem(OVERRIDES_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/** The key itself, for the instruction shown beside an active override. */
export { OVERRIDES_STORAGE_KEY }
