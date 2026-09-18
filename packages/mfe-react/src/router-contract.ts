/**
 * The author-facing router contract.
 *
 * An App *is* its router: the framework supplies the boundary history and the
 * route-callback context, and every other router option belongs to the author.
 * There is no layout option, because a layout is a root route with an outlet.
 */

import type { RouterHistory } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { MfeStorage, MfeTelemetry, ShellTheme, ShellUser } from '@company/mfe-core'

/**
 * Framework-owned services reachable from native route callbacks.
 *
 * `user`, `groups` and `theme` are the snapshot for *this invocation*: they do
 * not become live across an `await`, and UI that needs live values uses the
 * hooks. The service handles are stable for the mount's lifetime.
 */
export interface MfeContext {
  /** Readonly shell-state snapshot. Not an authorization API. */
  readonly user: ShellUser | null
  readonly groups: readonly string[]
  readonly theme: ShellTheme
  readonly telemetry: MfeTelemetry
  readonly storage: {
    readonly local: MfeStorage
    readonly session: MfeStorage
  }
  /** Aborts on disposal. Not a replacement for a loader's own abort signal. */
  readonly signal: AbortSignal
}

/**
 * Only `mfe` and `queryClient` are reserved. Authors may add their own top-level
 * keys and extend route context through native `beforeLoad`; they must not
 * replace or mutate `mfe`, add fields inside it, or replace the `queryClient`.
 */
export interface MfeRouterContext {
  readonly mfe: MfeContext
  /**
   * Top-level rather than inside `mfe`, so loaders use it as
   * `context.queryClient` exactly the way a non-federated TanStack app does.
   */
  readonly queryClient: QueryClient
}

/**
 * What the framework hands the author's router factory. `basePath` and
 * `history` must be passed through unchanged as the native `basepath` and
 * `history` options, and `context` spread rather than replaced.
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
 * Route `staticData` the framework reads. Declared here so the scaffold's module
 * augmentation has one source and a typo in a capability name is a build error.
 */
export interface MfeStaticData {
  /** Marks this route as a shell-openable capability. */
  readonly capability?: 'settings' | 'help' | 'releaseNotes'
  readonly label?: string
  /** An icon name from the shell icon set, or an asset URL. */
  readonly icon?: string | { readonly src: string }
  /** An explicit breadcrumb label, or `false` to hide this segment. */
  readonly breadcrumb?: string | false
}
