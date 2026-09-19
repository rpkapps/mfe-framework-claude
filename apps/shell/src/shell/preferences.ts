/**
 * The shell's own preferences, and where they are kept.
 *
 * The theme is the shell's to own: one page, one document class, one value
 * published to every mount. It cannot go through the framework's storage for
 * the same reason the dashboard layout cannot — that storage is scoped to a
 * definition and retired when the session changes, and the theme belongs to
 * none of the definitions on the page and should survive a sign-out.
 *
 * A stored value is untrusted: it was written by an older build or edited by
 * hand. Anything unreadable is treated as absent rather than trusted into the
 * document.
 */

export type ShellTheme = 'light' | 'dark'

const THEME_KEY = 'company:shell:theme'

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
 * system's, then the default. Kept here rather than in the inline script so
 * both agree on the order — the script exists only to apply it before paint.
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
