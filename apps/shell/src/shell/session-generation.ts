/**
 * The session generation the shell boots with.
 *
 * Session-retained storage is fenced by an opaque generation: a value written
 * under one session cannot be read back under the next, which is what stops a
 * previous user's draft reappearing for the person who signs in after them. The
 * framework mints a new generation whenever identity or groups change, but it
 * cannot invent the *first* one — the shell owns session identity, so only the
 * shell can say which session the page opened in.
 *
 * Without this every `retention: 'session'` write failed with the framework
 * saying exactly that, and the lab's visit counter counted nothing.
 *
 * The value is kept in `sessionStorage`, which is the same lifetime the data it
 * fences has: a reload keeps the tab's session and its counters, and a new tab
 * is a new session with none of them. It is deliberately not the framework's
 * mount-scoped storage — this is a boot fact, established before any mount
 * exists to store it through.
 */

const GENERATION_KEY = 'company:shell:session-generation'

/** Distinct per page load; enough on its own, and cheap without a secure context. */
function mint(userId: string): string {
  return `${userId}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`
}

/**
 * The generation for this tab's session: the one already in force if the user
 * is unchanged, otherwise a fresh one. Never repeats a previous value, which is
 * what the framework requires of it.
 */
export function sessionGeneration(userId: string): string {
  try {
    const stored = window.sessionStorage.getItem(GENERATION_KEY)
    if (stored !== null && stored.startsWith(`${userId}.`)) return stored

    const minted = mint(userId)
    window.sessionStorage.setItem(GENERATION_KEY, minted)
    return minted
  } catch {
    // Storage is blocked for this origin, so nothing session-retained can be
    // persisted anyway. A generation for this page's lifetime keeps every write
    // valid in memory rather than failing each one.
    return mint(userId)
  }
}
