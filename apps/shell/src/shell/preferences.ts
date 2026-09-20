/**
 * The shell's own preferences, and where they are kept.
 *
 * The theme is written raw — the bare string `"light"` or `"dark"` under the
 * bare key `theme` — because the legacy Angular applications read
 * `localStorage["theme"]` directly and can be taught no other key or shape.
 * The framework's store writes an envelope under a scoped key, so this one
 * value stays outside it deliberately (§24).
 *
 * A stored value is untrusted, so anything unreadable is treated as absent.
 */

export type ShellTheme = 'light' | 'dark'

/** Exactly what the legacy applications read. Never `@host:theme`. */
const THEME_KEY = 'theme'

/** The theme the document starts in when nothing was ever chosen. */
export const DEFAULT_THEME: ShellTheme = 'dark'

/** Reading `localStorage` throws outright when storage is blocked for the origin. */
function storage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function readTheme(): ShellTheme | null {
  try {
    const stored = storage()?.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

export function writeTheme(theme: ShellTheme): void {
  try {
    storage()?.setItem(THEME_KEY, theme)
  } catch {
    // A theme that cannot be remembered is still a theme that works.
  }
}

/**
 * What the document should boot in: the stored choice, then the operating
 * system's, then the default — the order the inline script applies before
 * paint, kept here too so the two cannot disagree about it.
 */
export function preferredTheme(): ShellTheme {
  const stored = readTheme()
  if (stored !== null) return stored

  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}
