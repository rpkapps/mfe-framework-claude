/**
 * The theme, declared once so every reader of `@host:theme` agrees.
 *
 * It is the shell's to own — one page, one document class, one value published
 * to every mount — and it has to outlive a sign-out, so it is kept with
 * `retention: 'browser'`. Nothing ever retires it.
 */

import { z } from 'zod'

export type ShellTheme = 'light' | 'dark'

export const ThemeSchema = z.enum(['light', 'dark'])

/** What the pre-paint script in index.html falls back to. */
export const DEFAULT_THEME: ShellTheme = 'dark'

/**
 * What the document is already painting. The inline script in index.html has
 * read the stored choice, the operating system's, then the default, and applied
 * it before this module ran — so the page needs no second reader before the
 * runtime exists, and read once here it cannot drift between components.
 */
export const BOOT_THEME: ShellTheme = document.documentElement.classList.contains('dark')
  ? DEFAULT_THEME
  : 'light'
