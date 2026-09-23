/** Neutral records the host orchestrates without knowing which adapter produced them. */

/** An array is a `typeof … === 'object'` too, and never what a record check means by one. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Every key whose value could be `undefined` becomes optional, and `undefined` drops out of it. */
type Compacted<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>
}

/**
 * Drops every key whose value is `undefined`, so a caller can assign an optional field straight
 * from a `T | undefined` computation instead of spreading `...(x === undefined ? {} : { x })` by
 * hand for each one. `exactOptionalPropertyTypes` treats "absent" and "present as undefined" as
 * different shapes, so the returned type carries the field as optional rather than as `X | undefined`.
 */
export function withoutUndefined<T extends Record<string, unknown>>(value: T): Compacted<T> {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const entry = value[key]
    if (entry !== undefined) result[key] = entry
  }
  return result as Compacted<T>
}

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
  /**
   * A key chord such as `'mod+s'`, or a sequence of chords separated by spaces such as `'g r'`.
   * `mod` is ⌘ on Apple platforms and Ctrl elsewhere. The command runs through the same path the
   * palette uses, so `canExecute` still decides. Only an App's commands and the host page's get
   * one: a Widget's is ignored, as is one the host page already uses.
   */
  readonly shortcut?: string
}

/** `id` is the runtime-qualified `<definitionId>:<name>`; authors provide only the local `name`. */
export interface CommandEntry {
  readonly id: string
  readonly definitionId: string
  readonly name: string
  readonly label: string
  readonly placements: readonly CommandPlacement[]
  readonly decision: Decision
  /**
   * The registration's shortcut in its normalized spelling (`'mod+shift+k'`, `'g r'`), present
   * only while it can fire: a Widget's, or one the host page reserved, is left off.
   */
  readonly shortcut?: string
}

/** Compares only what the palette displays, so closure identity changes are invisible. */
export function commandEntryEqual(a: CommandEntry, b: CommandEntry): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.label !== b.label || a.shortcut !== b.shortcut) return false
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

/**
 * Whether `pathname` is an App's own boundary or a path below it; `basePath` may carry a trailing
 * slash. The one containment test every navigator, router and boundary-aware command shares.
 */
export function isWithinBoundary(basePath: string, pathname: string): boolean {
  const boundary = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  return boundary === '' || pathname === boundary || pathname.startsWith(`${boundary}/`)
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
