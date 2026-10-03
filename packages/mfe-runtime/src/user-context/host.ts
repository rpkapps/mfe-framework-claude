import type { z } from 'zod'
import type { ShellUser } from '@company/mfe-core'
import {
  UserContextError,
  type UserContextAdapter,
  type UserContextOwner,
  type UserContextService,
} from '@company/mfe-core/user-context'

import type { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { UserContextRuntime } from './store.ts'

/** The owner ID of the shell's own slice. */
export const HOST_USER_CONTEXT_ID = 'shell'

/** The shell's persistence and its own declaration, beside it in the host factory. */
export interface HostUserContextOptions<
  Schema extends z.ZodObject | undefined = z.ZodObject | undefined,
> {
  /** The shell's own slice, owned under the ID `shell`. */
  readonly schema?: Schema
  /** Only the foreign fields this shell reads. */
  readonly reads?: Readonly<Record<string, z.ZodObject>>
  readonly adapter: UserContextAdapter
  readonly onError?: (error: unknown, id: string) => void
}

/** Partitions the per-user theme cache; never an authorization credential. */
export function userScope(user: ShellUser): string {
  return JSON.stringify([user.tenantId ?? null, user.accountId ?? null, user.id])
}

/**
 * Nothing is read or written while nobody is signed in, and the store starts over whenever the
 * signed-in user changes, so an old mount can never read the next user's data.
 */
export function createHostUserContext(options: {
  readonly persistence: HostUserContextOptions
  readonly shellState: ShellStateStore
}): { readonly service: UserContextService; dispose(): void } {
  const { persistence, shellState } = options
  const host: UserContextOwner | undefined =
    persistence.schema === undefined && persistence.reads === undefined
      ? undefined
      : {
          id: HOST_USER_CONTEXT_ID,
          userContext: {
            ...(persistence.schema === undefined ? {} : { schema: persistence.schema }),
            ...(persistence.reads === undefined ? {} : { reads: persistence.reads }),
          },
        }
  const runtime = new UserContextRuntime({
    adapter: persistence.adapter,
    host,
    ...(persistence.onError === undefined ? {} : { onError: persistence.onError }),
  })
  const identity = (user: ShellUser | null): string | null =>
    user === null ? null : userScope(user)
  let current = identity(shellState.getUser())
  const requireUser = (): void => {
    const user = shellState.getUser()
    if (user === null)
      throw new UserContextError(
        'not-ready',
        '<user>',
        'Sign in before reading or writing persisted user context',
      )
    // An identity observer registered before this one runs while the store still holds the
    // previous user; it must not start a request under the next user's session.
    if (identity(user) !== current)
      throw new UserContextError(
        'scope-disposed',
        '<user>',
        'The signed-in user changed; the shell remounts what it shows',
      )
  }
  const stop = shellState.observeTransitions(change => {
    if (!change.transitions.some(transition => transition.kind === 'identity')) return
    current = identity(change.next.user)
    runtime.reset()
  })
  return {
    service: {
      inspection: runtime.inspection,
      host,
      prepare: async (owner, signal) => {
        requireUser()
        await runtime.prepare(owner, signal)
      },
      bind: (owner, signal) => {
        requireUser()
        return runtime.bind(owner, signal)
      },
      bindReadOnly: (owner, ownerId, signal) => {
        requireUser()
        return runtime.bindReadOnly(owner, ownerId, signal)
      },
    },
    dispose: () => {
      stop()
      runtime.dispose()
    },
  }
}
