/** Neutral records the host orchestrates without knowing which adapter produced them. */

/** Only `command-palette` is standardized. */
export type CommandPlacement = 'command-palette'

export type Decision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

const ALLOWED: Decision = Object.freeze({ allowed: true as const })

export function allow(): Decision {
  return ALLOWED
}

export function deny(reason: string): Decision {
  return { allowed: false, reason }
}

export interface CommandRegistration {
  readonly name: string
  readonly label: string
  readonly execute: () => void | Promise<void>
  /** A pure synchronous read of reactive state; never an authorization boundary. */
  readonly canExecute?: () => Decision
  readonly placements?: readonly CommandPlacement[]
}

/** `id` is the runtime-qualified `<definitionId>:<name>`; authors provide only the local `name`. */
export interface CommandEntry {
  readonly id: string
  readonly definitionId: string
  readonly name: string
  readonly label: string
  readonly placements: readonly CommandPlacement[]
  readonly decision: Decision
}

/** Compares only what the palette displays, so closure identity changes are invisible. */
export function commandEntryEqual(a: CommandEntry, b: CommandEntry): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.label !== b.label) return false
  if (a.decision.allowed !== b.decision.allowed) return false
  if (!a.decision.allowed && !b.decision.allowed && a.decision.reason !== b.decision.reason) {
    return false
  }
  return arrayEqual(a.placements, b.placements)
}

/** The identifier field is `key`; `id` stays reserved for definition identity. */
export interface BreadcrumbItem {
  readonly key: string
  readonly label: string
  readonly href?: string
  readonly current?: boolean
}

function breadcrumbItemEqual(a: BreadcrumbItem, b: BreadcrumbItem): boolean {
  return (
    a === b ||
    (a.key === b.key && a.label === b.label && a.href === b.href && a.current === b.current)
  )
}

export function breadcrumbTrailEqual(
  a: readonly BreadcrumbItem[],
  b: readonly BreadcrumbItem[],
): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]
    const right = b[index]
    if (!left || !right || !breadcrumbItemEqual(left, right)) return false
  }
  return true
}

export interface ShellUser {
  readonly id: string
  readonly name: string
  readonly email?: string
  readonly accountId?: string
  readonly tenantId?: string
}

export type ShellTheme = 'light' | 'dark'

/** Data for rendering and UX decisions, explicitly not an authorization API. */
export interface ShellState {
  readonly user: ShellUser | null
  readonly groups: readonly string[]
  readonly theme: ShellTheme
}

/** Why shell state changed: a theme change must not invalidate what an identity change must. */
export type ShellTransition =
  | { readonly kind: 'theme' }
  | { readonly kind: 'token-refresh' }
  | { readonly kind: 'identity'; readonly reason: 'login' | 'logout' | 'account' | 'tenant' }
  | { readonly kind: 'groups' }

export interface BoundaryLocation {
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

/** The narrow internal bridge at an App boundary; not author API, never a global History patch. */
export interface NavigationBridge {
  read(): BoundaryLocation
  /** The boundary history keeps its bookkeeping here, so back and forward can be told apart. */
  readState?(): unknown
  subscribe(listener: (location: BoundaryLocation) => void): () => void
  push(to: string, state?: unknown): void
  replace(to: string, state?: unknown): void
  back(): void
  forward(): void
  /** Without it, only single steps are supported. */
  go?(delta: number): void
  reload(): void
}

/** The strings TanStack's history uses, named here so the core need not depend on a router. */
export type NavigationAction = 'PUSH' | 'REPLACE' | 'BACK' | 'FORWARD' | 'GO'

/** Blocking is decided by the MFE through TanStack's native blocker; the bridge only asks. */
export interface NavigationIntent {
  readonly from: BoundaryLocation
  readonly to: BoundaryLocation
  /** True when the transition removes the mount rather than moving within it. */
  readonly leavesBoundary: boolean
  /** Absent means the host did not say, and a reader should treat it as an ordinary push. */
  readonly action?: NavigationAction
}

/** Pure equality helpers; every stateful subscription primitive that uses them lives in
 * `@company/mfe-runtime`. */

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false

  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  const right = b as Record<string, unknown>
  for (const key of aKeys) {
    if (!Object.hasOwn(right, key)) return false
    if (!Object.is((a as Record<string, unknown>)[key], right[key])) return false
  }
  return true
}

export function arrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((entry, index) => Object.is(entry, b[index]))
}
