/** Reference server protocol. The repository must transact and commit durably before resolving. */
import { isValidDefinitionId } from '@company/mfe-core/definition'
import {
  assertJson,
  isObject,
  UserContextError,
  type Json,
  type StateRecord,
  type StateWrite,
} from '@company/mfe-core/user-context'

export interface StoredState {
  readonly revision: number
  readonly value: Json
}
export interface UserContextRepository {
  read(scope: string, id: string, signal: AbortSignal): Promise<StoredState | undefined>
  transact(
    scope: string,
    id: string,
    update: (current: StoredState | undefined) => StoredState,
    signal: AbortSignal,
  ): Promise<StoredState>
}
export interface UserContextBackendOptions {
  /** The owner the authenticated request may write, independent of the submitted record ID. */
  readonly resolveOwner: (scope: string, signal: AbortSignal) => Promise<string>
  readonly repository: UserContextRepository
  readonly authorize: (scope: string, id: string, operation: 'read' | 'write') => Promise<void>
}
export interface UserContextBackend {
  hydrate(
    scope: string,
    ids: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly StateRecord[]>
  write(scope: string, write: StateWrite, signal: AbortSignal): Promise<StateRecord>
}
/**
 * Every call takes the user's scope from the server's own authenticated request, never from the
 * browser. A write replaces the keys it submits in the stored record and bumps the revision; the last write
 * of a key wins.
 */
export function createUserContextBackend(options: UserContextBackendOptions): UserContextBackend {
  if (
    typeof options.resolveOwner !== 'function' ||
    typeof options.authorize !== 'function' ||
    typeof options.repository?.read !== 'function' ||
    typeof options.repository?.transact !== 'function'
  )
    throw new UserContextError(
      'invalid-value',
      '<backend>',
      'Supply trusted owner resolution, authorization, and a transactional repository',
    )
  return {
    async hydrate(scope, ids, signal) {
      assertScope(scope)
      if (!Array.isArray(ids) || !ids.every((id: unknown) => isValidDefinitionId(id)))
        throw new UserContextError('invalid-value', '<owners>', 'Supply valid owner IDs')
      signal.throwIfAborted()
      return await Promise.all(
        ids.map(async id => {
          await options.authorize(scope, id, 'read')
          const stored = await options.repository.read(scope, id, signal)
          if (!stored) return { id, revision: 0 }
          assertStored(stored, id)
          return { id, revision: stored.revision, value: structuredClone(stored.value) }
        }),
      )
    },
    async write(scope, write, signal) {
      const { id, value } = write
      assertScope(scope)
      signal.throwIfAborted()
      const ownerId = await options.resolveOwner(scope, signal)
      if (!isValidDefinitionId(ownerId) || ownerId !== id)
        throw new UserContextError(
          'unauthorized-owner',
          id,
          'Only the authenticated owner may write this slice',
        )
      await options.authorize(scope, id, 'write')
      assertObject(value, id)
      const patch = structuredClone(value)
      const stored = await options.repository.transact(
        scope,
        id,
        current => {
          if (current) assertStored(current, id)
          return {
            revision: (current?.revision ?? 0) + 1,
            // Each submitted key replaces the stored one; keys it leaves out stay as they were.
            value: { ...(isObject(current?.value) ? current.value : {}), ...patch },
          }
        },
        signal,
      )
      return { id, revision: stored.revision, value: structuredClone(stored.value) }
    },
  }
}

function assertScope(scope: string): void {
  if (typeof scope !== 'string' || scope.length === 0)
    throw new UserContextError(
      'invalid-value',
      '<user>',
      'Supply a nonempty authenticated user scope',
    )
}

/** Persistence validates the JSON shape only; each client validates with its own schema. */
function assertObject(value: unknown, id: string): asserts value is Record<string, Json> {
  assertJson(value, id)
  if (!isObject(value))
    throw new UserContextError('invalid-value', id, 'An owner value must be a JSON object')
}

function assertStored(stored: StoredState, id: string): void {
  if (!Number.isSafeInteger(stored.revision) || stored.revision < 1)
    throw new UserContextError('invalid-value', id, 'Invalid stored record metadata')
  assertObject(stored.value, id)
}
