import type { ShellTheme, ShellUser } from '@company/mfe-core'
import type { UserContextRequirements, UserContextService } from '@company/mfe-core/user-context'
import type { ShellStateStore } from '../shell-state/shell-state-store.ts'

export type ThemePreference = 'light' | 'dark' | 'system'
export interface UserContextThemeOptions<V> {
  readonly select: (context: Readonly<V>) => ThemePreference
  /** Framework-owned startup cache, automatically partitioned by authenticated user ID. */
  readonly cacheKey: string
}

export function themeCacheKey(cacheKey: string, user: ShellUser): string {
  return `${cacheKey}:${encodeURIComponent(JSON.stringify([user.tenantId ?? null, user.accountId ?? null, user.id]))}`
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

/** Keep shellState, the document, and the selected-value cache in step with confirmed records. */
export function attachUserContextTheme(options: {
  readonly service: UserContextService
  readonly requirements: UserContextRequirements
  readonly shellState: ShellStateStore
  readonly theme: UserContextThemeOptions<unknown>
}): () => void {
  const { service, requirements, shellState, theme } = options
  let current: ThemePreference = 'system'
  let stopped = false
  const apply = (): void => {
    const value = resolveTheme(current)
    shellState.apply({ theme: value })
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', value === 'dark')
      document.documentElement.style.colorScheme = value
    }
  }
  const read = (): void => {
    if (stopped) return
    const entry = service.inspection
      ?.getSnapshot()
      .entries.find(item => item.contract.id === requirements.ownerId)
    if (entry?.confirmed === undefined || entry.status === 'invalid') return
    // Selectors are author code; a bad selector must not interrupt a successful persistence write.
    try {
      const selected = preference(theme.select(entry.confirmed as Readonly<unknown>))
      if (selected === undefined) return
      current = selected
      apply()
      // Scope changes can synchronously publish before our identity observer runs.
      const identity = shellState.getUser()
      if (identity !== null) {
        try {
          globalThis.localStorage?.setItem(themeCacheKey(theme.cacheKey, identity), selected)
        } catch {
          /* Storage can be blocked. */
        }
      }
    } catch {
      /* Keep the last usable theme if the selector cannot read this record. */
    }
  }
  const initialize = (): void => {
    current = readCachedTheme(theme.cacheKey, shellState.getUser())
    apply()
    void service.prepare(requirements).then(read, () => {})
  }
  const stopInspection = service.inspection?.subscribe(read)
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
    stopInspection?.()
    stopIdentity()
    media?.removeEventListener('change', changed)
  }
}
