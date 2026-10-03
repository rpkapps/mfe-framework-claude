import type { Registry, ShellUser } from '@company/mfe-core'
import {
  UserContextError,
  type StateContract,
  type UserContextAdapter,
  type UserContextRequirements,
  type UserContextService,
} from '@company/mfe-core/user-context'

import type { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { UserContextRuntime } from './store.ts'

/** Persistence is the shell's concern; generated deployment metadata supplies the contracts. */
export interface HostUserContextOptions {
  readonly adapter: UserContextAdapter
  readonly onError?: (error: unknown, id: string) => void
}

/** @internal Supplied by the generated host entry, never assembled by application code. */
export interface HostUserContextDefinition {
  readonly contract?: StateContract
  readonly requirements: UserContextRequirements
}

/** An opaque transport partition, never an authorization credential. */
function identity(user: ShellUser | null): string {
  return user === null
    ? '@signed-out'
    : JSON.stringify([user.tenantId ?? null, user.accountId ?? null, user.id])
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
  const requireUser = (): void => {
    if (shellState.getUser() === null)
      throw new UserContextError(
        'not-ready',
        '<user>',
        'Sign in before reading or writing persisted user context',
      )
  }
  const adapter: UserContextAdapter = {
    hydrate: (scope, ids, signal) => {
      requireUser()
      return persistence.adapter.hydrate(scope, ids, signal)
    },
    write: (operation, signal) => {
      requireUser()
      return persistence.adapter.write(operation, signal)
    },
    subscribe: (scope, listener, signal) => {
      if (shellState.getUser() === null) return () => {}
      return persistence.adapter.subscribe?.(scope, listener, signal) ?? (() => {})
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
