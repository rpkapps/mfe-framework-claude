import type { z } from 'zod'
import type { Registry, ShellUser } from '@company/mfe-core'
import {
  UserContextError,
  type StateContract,
  type UserContextAdapter as ScopedUserContextAdapter,
  type StateWrite as ScopedStateWrite,
  type StateRecord,
  type UserContextRequirements,
  type UserContextService,
} from '@company/mfe-core/user-context'

import type { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { UserContextRuntime } from './store.ts'

/** A write for the signed-in user; authentication identifies the user at the backend. */
export type StateWrite = Omit<ScopedStateWrite, 'scope'>

/** Shell persistence transport. The framework manages user changes and request cancellation. */
export interface UserContextAdapter {
  hydrate(ids: readonly string[], signal: AbortSignal): Promise<readonly StateRecord[]>
  write(operation: StateWrite, signal: AbortSignal): Promise<StateRecord>
  subscribe?(listener: (record: StateRecord) => void, signal: AbortSignal): () => void
}

/** Persistence is the shell's concern; generated deployment metadata supplies the contracts. */
export interface HostUserContextOptions<
  Schema extends z.ZodObject | undefined = z.ZodObject | undefined,
> {
  /** Own values, compiled away by the host builder. */
  readonly schema?: Schema
  /** Only the foreign fields this shell reads, compiled away by the host builder. */
  readonly reads?: Readonly<Record<string, z.ZodObject>>
  readonly adapter: UserContextAdapter
  readonly onError?: (error: unknown, id: string) => void
}

/** @internal Injected by the host build transform, never assembled by application code. */
export interface HostUserContextDefinition {
  readonly contract?: StateContract
  readonly requirements: UserContextRequirements
}

/** An opaque transport partition, never an authorization credential. */
export function userScope(user: ShellUser): string {
  return JSON.stringify([user.tenantId ?? null, user.accountId ?? null, user.id])
}

function identity(user: ShellUser | null): string {
  return user === null ? '@signed-out' : userScope(user)
}

/**
 * The host derives identity from its existing session lifecycle. The low-level runtime retains
 * its explicit scope API for servers and tests; a browser shell never has to coordinate it.
 */
export function createHostUserContext(options: {
  readonly persistence: HostUserContextOptions
  readonly registry: Registry
  readonly shellState: ShellStateStore
  readonly definition?: HostUserContextDefinition | undefined
}): { readonly service: UserContextService; dispose(): void } {
  const { persistence, registry, shellState, definition } = options
  const contracts = [...registry.entries.values()].flatMap(entry => {
    const contract = entry.userContextContract
    if (contract === undefined) return []
    if (contract.id !== entry.id)
      throw new UserContextError(
        'unsupported-contract',
        entry.id,
        'Registry contract owner does not match its definition',
      )
    return [contract]
  })
  if (definition?.contract !== undefined) {
    if (definition.contract.id !== definition.requirements.ownerId)
      throw new UserContextError(
        'unsupported-contract',
        definition.contract.id,
        'Shell contract owner does not match its generated definition',
      )
    contracts.push(definition.contract)
  }
  const requireUser = (scope?: string): void => {
    if (shellState.getUser() === null)
      throw new UserContextError(
        'not-ready',
        '<user>',
        'Sign in before reading or writing persisted user context',
      )
    if (scope !== undefined && scope !== identity(shellState.getUser()))
      throw new UserContextError(
        'scope-disposed',
        '<user>',
        'The request belongs to a previous signed-in identity',
      )
  }
  const adapter: ScopedUserContextAdapter = {
    hydrate: (scope, ids, signal) => {
      requireUser(scope)
      return persistence.adapter.hydrate(ids, signal)
    },
    write: (operation, signal) => {
      requireUser(operation.scope)
      const { scope: _scope, ...write } = operation
      return persistence.adapter.write(write, signal)
    },
    subscribe: (scope, listener, signal) => {
      if (shellState.getUser() === null) return () => {}
      requireUser(scope)
      return persistence.adapter.subscribe?.(listener, signal) ?? (() => {})
    },
  }
  const runtime = new UserContextRuntime({
    schema: { formatVersion: 1, contracts },
    scope: identity(shellState.getUser()),
    adapter,
    ...(persistence.onError === undefined ? {} : { onError: persistence.onError }),
  })
  const stop = shellState.observeTransitions(change => {
    if (change.transitions.some(transition => transition.kind === 'identity'))
      runtime.setScope(identity(change.next.user))
  })
  return {
    service: {
      protocolVersion: 1,
      inspection: runtime.inspection,
      prepare: async (requirements, signal) => {
        requireUser()
        await runtime.prepare(requirements, signal)
      },
      bind: (definitionId, requirements, signal) => {
        requireUser()
        return runtime.bind(definitionId, requirements, signal)
      },
      bindReadOnly: (definitionId, requirements, ownerId, signal) => {
        requireUser()
        return runtime.bindReadOnly(definitionId, requirements, ownerId, signal)
      },
    },
    dispose: () => {
      stop()
      runtime.dispose()
    },
  }
}
