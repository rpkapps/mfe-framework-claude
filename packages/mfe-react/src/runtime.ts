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
  /** One per mount and security session, so a child never inherits a parent's cache. */
  readonly queryClient: QueryClient
  /** Internal provider subscription; security transitions replace the whole cache boundary. */
  readonly querySession: {
    readonly getSnapshot: () => QuerySession
    readonly subscribe: (listener: () => void) => () => void
  }
}

interface QuerySession {
  readonly generation: number
  readonly client: QueryClient
}

/**
 * The React side of one mount context: its own Query client, retired on a security transition.
 * A new client isolates late mutation callbacks as well as queries that ignore AbortSignal:
 * closures keep the retired client, never the next session's visible cache. The keyed provider
 * also replaces route caches and observers, rather than leaving an observer on a removed query.
 * The context aborts after removing the mount's registrations and before closing its telemetry,
 * so nothing the client still runs can register or report into a mount that has gone. Signalled,
 * not waited on: teardown must not block on in-flight requests.
 */
export function withQueryClient(context: MountContext): MfeMount {
  let session: QuerySession = { generation: 0, client: new QueryClient() }
  const listeners = new Set<() => void>()

  const retire = (client: QueryClient): void => {
    void client.cancelQueries()
    client.clear()
  }

  const unsubscribe = context.runtime.shellState.observeTransitions(change => {
    if (context.signal.aborted) return
    if (
      !change.transitions.some(
        transition => transition.kind === 'identity' || transition.kind === 'groups',
      )
    )
      return

    const previous = session.client
    session = { generation: session.generation + 1, client: new QueryClient() }
    retire(previous)
    for (const listener of [...listeners]) listener()
  })

  const dispose = (): void => {
    unsubscribe()
    listeners.clear()
    retire(session.client)
  }
  if (context.signal.aborted) dispose()
  else context.signal.addEventListener('abort', dispose, { once: true })

  return {
    ...context,
    get queryClient() {
      return session.client
    },
    querySession: {
      getSnapshot: () => session,
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
  }
}
