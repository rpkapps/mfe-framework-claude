/** The shell remembers its theme before the framework runtime boots. */

export type ShellTheme = 'light' | 'dark'

const THEME_KEY = 'theme'

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

/** The order the inline script in `index.html` applies before paint, kept here so the two cannot disagree. */
export function preferredTheme(): ShellTheme {
  const stored = readTheme()
  if (stored !== null) return stored

  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}
