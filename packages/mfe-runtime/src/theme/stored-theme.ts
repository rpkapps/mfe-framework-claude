/**
 * The runtime owns the effective theme: the shell names the stored key that holds the preference,
 * and the runtime keeps `shellState`, the document and a per-user pre-paint cache in step with it.
 */

import { HOST_SCOPE, type AnyStoredKey, type ShellTheme, type ShellUser } from '@company/mfe-core'

import type { ShellStateStore } from '../shell-state/shell-state-store.ts'
import type { StorageService } from '../storage/service.ts'

export type ThemePreference = 'light' | 'dark' | 'system'

// `cacheKey`, `resolveTheme` and `paint` also run before first paint, inlined by their source into
// `themeBootstrapScript()`, so each is self-contained and the runtime and the script cannot disagree.

/** Partitioned by tenant, account and user, so nobody starts with another user's preference. */
function cacheKey(tenantId: string | null, accountId: string | null, userId: string): string {
  return 'mfe:theme:' + encodeURIComponent(JSON.stringify([tenantId, accountId, userId]))
}

function resolveTheme(stored: unknown): ShellTheme {
  if (stored === 'light' || stored === 'dark') return stored
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** `dark` is what the design system's variant keys off. */
function paint(theme: ShellTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

function prepaint(key: typeof cacheKey, resolve: typeof resolveTheme, apply: typeof paint): void {
  try {
    // A server may name the authenticated identity. A static shell cannot, so it starts in the
    // preference of whoever last signed in on this browser, and the runtime corrects it once it
    // knows the user. Only light or dark carries over, never anything else of theirs.
    const { userId, tenantId, accountId } = document.documentElement.dataset
    const last = localStorage.getItem('mfe:theme:last')
    const cached = userId
      ? key(tenantId ?? null, accountId ?? null, userId)
      : last !== null && last.startsWith('mfe:theme:%5B')
        ? last
        : null
    apply(resolve(cached === null ? null : localStorage.getItem(cached)))
  } catch {
    // Storage blocked: the class in <html> already stands.
  }
}

/**
 * The inline `<script>` body a host puts before its first paint, so a reload starts in the cached
 * preference of the user the server names in `<html data-user-id data-tenant-id data-account-id>`,
 * or, when it names nobody, of the user who last signed in on this browser.
 */
export function themeBootstrapScript(): string {
  return `;(${prepaint.toString()})(${cacheKey.toString()}, ${resolveTheme.toString()}, ${paint.toString()})`
}

/** Which user's cache the pre-paint script reads when the server names nobody. */
const LAST_THEME_KEY = 'mfe:theme:last'

/** Not exported from the package; the tests seed the cache with it. */
export function themeCacheKey(user: ShellUser): string {
  return cacheKey(user.tenantId ?? null, user.accountId ?? null, user.id)
}

function preference(value: unknown): ThemePreference | undefined {
  return value === 'light' || value === 'dark' || value === 'system' ? value : undefined
}

/** Safe before anything mounts; unknown identities never read a previous user's preference. */
function readCachedTheme(user: ShellUser | null | undefined): ThemePreference {
  try {
    return (
      (user == null
        ? undefined
        : preference(globalThis.localStorage?.getItem(themeCacheKey(user)))) ?? 'system'
    )
  } catch {
    return 'system'
  }
}

/** The theme a runtime starts with, before the user's stored values have loaded. */
export function cachedTheme(user: ShellUser | null | undefined): ShellTheme {
  return resolveTheme(readCachedTheme(user))
}

/**
 * Keeps shellState, the document and the cache in step with the host-owned `key`. Until the user
 * area has loaded, and after a failed load, the signed-in user's cached preference stands; only a
 * value the backend confirmed is cached.
 */
export function attachStoredTheme(options: {
  readonly storage: StorageService
  readonly shellState: ShellStateStore
  readonly key: AnyStoredKey<ThemePreference>
}): () => void {
  const { storage, shellState, key } = options
  const binding = storage.bind({ owner: HOST_SCOPE }, key)
  let current: ThemePreference = readCachedTheme(shellState.getUser())

  const apply = (): void => {
    const value = resolveTheme(current)
    shellState.apply({ theme: value })
    paint(value)
  }

  const read = (): void => {
    const loaded = key.storage !== 'user' || storage.user?.phase === 'ready'
    // Identity changes reset the user area, so this also picks up the next user's cache.
    if (!loaded) {
      current = readCachedTheme(shellState.getUser())
      apply()
      return
    }
    const { value, status, error } = binding.getSnapshot()
    // A stored value that no longer matches the schema keeps the last usable theme.
    if (status === 'error' && error?.code === 'storage/invalid-value') return
    const selected = preference(value)
    if (selected === undefined) return
    current = selected
    apply()
    const identity = shellState.getUser()
    if (status !== 'ready' || identity === null) return
    try {
      const cached = themeCacheKey(identity)
      globalThis.localStorage?.setItem(cached, selected)
      globalThis.localStorage?.setItem(LAST_THEME_KEY, cached)
    } catch {
      /* Storage can be blocked. */
    }
  }

  const stopBinding = binding.subscribe(read)
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined
  const changed = (): void => {
    if (current === 'system') apply()
  }
  media?.addEventListener('change', changed)
  read()
  return () => {
    stopBinding()
    binding.release()
    media?.removeEventListener('change', changed)
  }
}
