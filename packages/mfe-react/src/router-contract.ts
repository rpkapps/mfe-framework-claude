/** The framework supplies history and context; every other router option is the author's. */

import type { RouterHistory } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { MfeStorage, MfeTelemetry, ShellTheme, ShellUser } from '@company/mfe-core'

/** `user`, `groups` and `theme` are snapshots and do not become live across an `await`. */
export interface MfeContext {
  /** Not an authorization API. */
  readonly user: ShellUser | null
  readonly groups: readonly string[]
  readonly theme: ShellTheme
  readonly telemetry: MfeTelemetry
  readonly storage: {
    readonly local: MfeStorage
    readonly session: MfeStorage
  }
  /** Aborts on mount disposal; a loader keeps using its own abort signal. */
  readonly signal: AbortSignal
}

/** Authors may add top-level keys, but must not replace or mutate `mfe` or the `queryClient`. */
export interface MfeRouterContext {
  readonly mfe: MfeContext
  readonly queryClient: QueryClient
}

/** `basePath` and `history` must be passed through unchanged, and `context` spread not replaced. */
export interface AppRouterOptions {
  readonly basePath: string
  readonly history: RouterHistory
  readonly context: MfeRouterContext
}

export const RESERVED_CONTEXT_KEYS = ['mfe', 'queryClient'] as const
export type ReservedContextKey = (typeof RESERVED_CONTEXT_KEYS)[number]

/** Declared here so the scaffold's module augmentation has one source. */
export interface MfeStaticData {
  readonly capability?: 'settings' | 'help' | 'releaseNotes'
  readonly label?: string
  /** An icon name from the shell icon set, or an asset URL. */
  readonly icon?: string | { readonly src: string }
  /** An explicit breadcrumb label, or `false` to hide this segment. */
  readonly breadcrumb?: string | false
}
