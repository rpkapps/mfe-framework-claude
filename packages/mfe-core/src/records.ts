/**
 * Neutral records shared by the host and its adapters: commands, breadcrumbs,
 * shell state and the navigation bridge. They live here so the host can
 * orchestrate them without knowing which adapter produced them, and a second
 * adapter needs no new vocabulary.
 */

import { arrayEqual } from './observable.ts'

/** Only `command-palette` is standardized. */
export type CommandPlacement = 'command-palette'

export type Decision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

const ALLOWED: Decision = Object.freeze({ allowed: true as const })

/** Keeps a registration a single line, and keeps one allowed value cached. */
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
  /** A pure synchronous read of reactive state. Never an authorization boundary. */
  readonly canExecute?: () => Decision
  readonly placements?: readonly CommandPlacement[]
}

/**
 * What the palette renders. `id` is the runtime-qualified `<definitionId>:<name>`;
 * authors only ever provide the local `name`.
 */
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

/**
 * Data for rendering and UX decisions — explicitly not an authorization API.
 * The host and backend remain responsible for authorization.
 */
export interface ShellState {
  readonly user: ShellUser | null
  readonly groups: readonly string[]
  readonly theme: ShellTheme
}

/**
 * Why shell state changed. The host uses this to decide what to invalidate: a
 * theme change must not reload data, while an identity or group change must
 * retire session-dependent work and persisted state.
 */
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
 * The narrow internal bridge the shell provides at an App boundary. It is not
 * part of the author API and must never be implemented as a global History patch.
 */
export interface NavigationBridge {
  read(): BoundaryLocation
  /**
   * The opaque state stored with the current entry. The boundary history keeps
   * its own bookkeeping there so browser back and forward can be told apart
   * without inspecting `window.history` directly.
   */
  readState?(): unknown
  subscribe(listener: (location: BoundaryLocation) => void): () => void
  push(to: string, state?: unknown): void
  replace(to: string, state?: unknown): void
  back(): void
  forward(): void
  /** Relative traversal. Optional: without it, only single steps are supported. */
  go?(delta: number): void
  reload(): void
}

/**
 * How a navigation was started. The same strings TanStack's history uses, named
 * here so `@company/mfe-core` does not depend on a router to describe one.
 */
export type NavigationAction = 'PUSH' | 'REPLACE' | 'BACK' | 'FORWARD' | 'GO'

/**
 * A mount's answer when a navigation would leave or remove it. Blocking is
 * decided by the MFE through TanStack's native blocker; the bridge only asks.
 */
export interface NavigationIntent {
  readonly from: BoundaryLocation
  readonly to: BoundaryLocation
  /** True when the transition removes the mount rather than moving within it. */
  readonly leavesBoundary: boolean
  /**
   * What the user did: a link, a redirect, the back button. An MFE's blocker
   * reads it — refusing a back button and allowing a replace is a real
   * distinction — so a host that knows the action passes it on. Absent means
   * the host did not say, and a reader should treat it as an ordinary push.
   */
  readonly action?: NavigationAction
}
