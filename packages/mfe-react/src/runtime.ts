/**
 * The runtime a shell installs once and the per-mount context derived from it: anything on
 * `MfeMount` is destroyed with that mount, anything on `MfeRuntime` outlives it. Both are the
 * host's neutral shapes; a React mount adds only the Query client its tree is rendered with.
 */

import type { MfeHostRuntime, MountContext } from '@company/mfe-host'
import type { QueryClient } from '@tanstack/react-query'

/** Shared, shell-owned services, one instance per document. */
export type MfeRuntime = MfeHostRuntime

/** Everything one mount owns. */
export interface MfeMount extends MountContext {
  /** One per mount, so a child never inherits a parent's cache. */
  readonly queryClient: QueryClient
}

export { createMountToken } from '@company/mfe-host'
