/**
 * The runtime a shell installs once and the per-mount context derived from it: anything on
 * `MfeMount` is destroyed with that mount, anything on `MfeRuntime` outlives it. Both are the
 * runtime's neutral shapes; a React mount adds only the Query client its tree is rendered with.
 */

import type { MountContext } from '@company/mfe-runtime'
import { QueryClient } from '@tanstack/react-query'

/** Shared, shell-owned services, one instance per document. */
export type { MfeRuntime } from '@company/mfe-runtime'

/** Everything one mount owns. */
export interface MfeMount extends MountContext {
  /** One per mount, so a child never inherits a parent's cache. */
  readonly queryClient: QueryClient
}

/**
 * The React side of one mount context: its own Query client, cleared when the context aborts.
 * The context aborts after removing the mount's registrations and before closing its telemetry,
 * so nothing the client still runs can register or report into a mount that has gone. Signalled,
 * not waited on: teardown must not block on in-flight requests.
 */
export function withQueryClient(context: MountContext): MfeMount {
  const queryClient = new QueryClient()

  context.signal.addEventListener(
    'abort',
    () => {
      void queryClient.cancelQueries()
      queryClient.clear()
    },
    { once: true },
  )

  return { ...context, queryClient }
}
