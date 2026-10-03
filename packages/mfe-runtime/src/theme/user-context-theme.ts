import type { ShellTheme, ShellUser } from '@company/mfe-core'
import type { UserContextHost, UserContextStore } from '@company/mfe-core/user-context'
import type { ShellStateStore } from '../shell-state/shell-state-store.ts'

type ThemePreference = 'light' | 'dark' | 'system'
export type ThemeSelector<V> = (context: Readonly<V>) => ThemePreference

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
    // A server may provide the authenticated identity. Without it, use system until sign-in.
    const { userId, tenantId, accountId } = document.documentElement.dataset
    apply(
      resolve(
        userId ? localStorage.getItem(key(tenantId ?? null, accountId ?? null, userId)) : null,
      ),
    )
  } catch {
    // Storage blocked: the class in <html> already stands.
  }
}

/**
 * The inline `<script>` body a host puts before its first paint, so a reload starts in the cached
 * preference of the user the server names in `<html data-user-id data-tenant-id data-account-id>`.
 */
export function themeBootstrapScript(): string {
  return `;(${prepaint.toString()})(${cacheKey.toString()}, ${resolveTheme.toString()}, ${paint.toString()})`
}

/** Not exported from the package; the tests seed the cache with it. */
export function themeCacheKey(user: ShellUser): string {
  return cacheKey(user.tenantId ?? null, user.accountId ?? null, user.id)
}

function preference(value: unknown): ThemePreference | undefined {
  return value === 'light' || value === 'dark' || value === 'system' ? value : undefined
}

/** Safe before React mounts; unknown identities never read a previous user's preference. */
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

/** The theme a runtime starts with, before its user context has loaded. */
export function cachedTheme(user: ShellUser | null | undefined): ShellTheme {
  return resolveTheme(readCachedTheme(user))
}

/** Keep shellState, the document, and the selected-value cache in step with stored records. */
export function attachUserContextTheme(options: {
  readonly host: UserContextHost
  readonly shellState: ShellStateStore
  readonly select: ThemeSelector<unknown>
}): () => void {
  const { host, shellState, select } = options
  let current: ThemePreference = 'system'
  let stopped = false
  let store: UserContextStore | undefined
  let stopObserving: (() => void) | undefined
  let attempt = 0
  const apply = (): void => {
    const value = resolveTheme(current)
    shellState.apply({ theme: value })
    paint(value)
  }
  const read = (): void => {
    if (stopped || store === undefined) return
    // Selectors are author code; a bad selector or an invalid record keeps the last usable theme.
    try {
      const selected = preference(select(store.getSnapshot()))
      if (selected === undefined) return
      current = selected
      apply()
      const identity = shellState.getUser()
      if (identity !== null) {
        try {
          globalThis.localStorage?.setItem(themeCacheKey(identity), selected)
        } catch {
          /* Storage can be blocked. */
        }
      }
    } catch {
      /* Keep the last usable theme. */
    }
  }
  // The host starts a new preparation for every signed-in user and after a retried failure.
  const initialize = (): void => {
    stopObserving?.()
    stopObserving = undefined
    store = undefined
    const mine = ++attempt
    current = readCachedTheme(shellState.getUser())
    apply()
    if (shellState.getUser() === null) return
    host
      .prepared()
      .then(prepared => {
        if (stopped || mine !== attempt) return
        store = prepared.userContext
        stopObserving = store.observe(read)
        read()
      })
      // A failed load keeps the cached theme; a retry or the next user starts over.
      .catch(() => undefined)
  }
  const stopHost = host.subscribe(initialize)
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined
  const changed = (): void => {
    if (current === 'system') apply()
  }
  media?.addEventListener('change', changed)
  initialize()
  return () => {
    stopped = true
    stopObserving?.()
    stopHost()
    media?.removeEventListener('change', changed)
  }
}
