/**
 * The author-facing router contract.
 *
 * An App *is* its router. The framework supplies the boundary history and the
 * route-callback context; every other router option belongs to the author.
 * There is no layout, render or component option, because a layout is a root
 * route with an outlet, which is the native way to express it.
 */

import type { RouterHistory } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { MfeStorage, MfeTelemetry, ShellTheme, ShellUser } from '@company/mfe-core'

/**
 * Framework-owned services and snapshots reachable from native route callbacks.
 *
 * `user`, `groups` and `theme` are the snapshot for *this invocation*. They do
 * not become live across an `await`; UI that needs live values uses the hooks.
 * The service handles are stable for the mount's lifetime.
 */
export interface MfeContext {
  /** Readonly shell-state snapshot. Not an authorization API. */
  readonly user: ShellUser | null
  readonly groups: readonly string[]
  readonly theme: ShellTheme
  /** Stable mount-bound telemetry service. */
  readonly telemetry: MfeTelemetry
  /** Stable namespaced storage handles. */
  readonly storage: {
    readonly local: MfeStorage
    readonly session: MfeStorage
  }
  /** Aborts on disposal. Not a replacement for a loader's own abort signal. */
  readonly signal: AbortSignal
}

/**
 * The router context the framework contributes.
 *
 * Only the top-level `mfe` namespace and `queryClient` are reserved. Authors
 * may add their own top-level keys — including names like `user` for their own
 * distinct data — and may extend route context through native `beforeLoad`.
 * They must not replace or mutate `mfe`, add fields inside it, or replace the
 * supplied `queryClient`.
 */
export interface MfeRouterContext {
  readonly mfe: MfeContext
  /**
   * The mount's stable Query client. Intentionally top-level rather than inside
   * `mfe`, because loaders use it as `context.queryClient` exactly the way a
   * non-federated TanStack app does.
   */
  readonly queryClient: QueryClient
}

/**
 * What the framework hands the author's router factory.
 *
 * The factory must pass `basePath` through unchanged as the native `basepath`
 * option and `history` through unchanged as the native `history` option. It
 * must spread `context` into the router context rather than replacing it.
 */
export interface AppRouterOptions {
  readonly basePath: string
  readonly history: RouterHistory
  readonly context: MfeRouterContext
}

/** The reserved top-level context keys authors must not replace. */
export const RESERVED_CONTEXT_KEYS = ['mfe', 'queryClient'] as const
export type ReservedContextKey = (typeof RESERVED_CONTEXT_KEYS)[number]

/**
 * Route `staticData` the framework reads.
 *
 * Declared here so the scaffold's module augmentation has one source, and so a
 * typo in a capability name is a build error rather than a silent omission.
 */
export interface MfeStaticData {
  /** Marks this route as a shell-openable capability. */
  readonly capability?: 'settings' | 'help' | 'releaseNotes'
  /** Label the shell shows for the capability. */
  readonly label?: string
  /** An icon name from the shell icon set, or an asset URL. */
  readonly icon?: string | { readonly src: string }
  /** An explicit breadcrumb label, or `false` to hide this segment. */
  readonly breadcrumb?: string | false
}
