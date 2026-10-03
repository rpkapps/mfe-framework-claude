import type { ShellTheme, ShellUser } from '@company/mfe-core'
import type {
  UserContextOwner,
  UserContextService,
  UserContextStore,
} from '@company/mfe-core/user-context'
import type { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { userScope } from '../user-context/host.ts'

export type ThemePreference = 'light' | 'dark' | 'system'
export interface UserContextThemeOptions<V> {
  readonly select: (context: Readonly<V>) => ThemePreference
  /** Framework-owned startup cache, automatically partitioned by authenticated user ID. */
  readonly cacheKey: string
}

export function themeCacheKey(cacheKey: string, user: ShellUser): string {
  return `${cacheKey}:${encodeURIComponent(userScope(user))}`
}

function preference(value: unknown): ThemePreference | undefined {
  return value === 'light' || value === 'dark' || value === 'system' ? value : undefined
}

/** Safe before React mounts; unknown identities never read a previous user's preference. */
export function readCachedTheme(
  cacheKey: string,
  user: ShellUser | null | undefined,
): ThemePreference {
  try {
    return (
      (user == null
        ? undefined
        : preference(globalThis.localStorage?.getItem(themeCacheKey(cacheKey, user)))) ?? 'system'
    )
  } catch {
    return 'system'
  }
}

export function resolveTheme(value: ThemePreference): ShellTheme {
  if (value !== 'system') return value
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** Keep shellState, the document, and the selected-value cache in step with stored records. */
export function attachUserContextTheme(options: {
  readonly service: UserContextService
  readonly owner: UserContextOwner
  readonly shellState: ShellStateStore
  readonly theme: UserContextThemeOptions<unknown>
}): () => void {
  const { service, owner, shellState, theme } = options
  let current: ThemePreference = 'system'
  let stopped = false
  let store: UserContextStore | undefined
  let stopObserving: (() => void) | undefined
  const apply = (): void => {
    const value = resolveTheme(current)
    shellState.apply({ theme: value })
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', value === 'dark')
      document.documentElement.style.colorScheme = value
    }
  }
  const read = (): void => {
    if (stopped || store === undefined) return
    // Selectors are author code; a bad selector or an invalid record keeps the last usable theme.
    try {
      const selected = preference(theme.select(store.getSnapshot()))
      if (selected === undefined) return
      current = selected
      apply()
      const identity = shellState.getUser()
      if (identity !== null) {
        try {
          globalThis.localStorage?.setItem(themeCacheKey(theme.cacheKey, identity), selected)
        } catch {
          /* Storage can be blocked. */
        }
      }
    } catch {
      /* Keep the last usable theme. */
    }
  }
  const initialize = (): void => {
    stopObserving?.()
    stopObserving = undefined
    store = undefined
    current = readCachedTheme(theme.cacheKey, shellState.getUser())
    apply()
    if (shellState.getUser() === null) return
    service
      .prepare(owner)
      .then(() => {
        if (stopped) return
        store = service.bind(owner)
        stopObserving = store.observe(read)
        read()
      })
      // A user change while loading starts over through the identity observer below.
      .catch(() => undefined)
  }
  const stopIdentity = shellState.observeTransitions(change => {
    if (change.transitions.some(transition => transition.kind === 'identity')) initialize()
  })
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
    stopIdentity()
    media?.removeEventListener('change', changed)
  }
}
