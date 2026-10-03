import { isValidDefinitionId } from '@company/mfe-core/definition'
/** Reference server protocol. The repository must transact and commit durably before resolving. */
import {
  mergeStateValue,
  isObject,
  assertJson,
  UserContextError,
  stableJson,
  type Json,
  type StateRecord,
  type StateWrite,
} from '@company/mfe-core/user-context'

export interface StoredState {
  readonly revision: number
  readonly value: Json
  /** Idempotency receipts retained by the backend for its documented retry window. */
  readonly receipts: Readonly<
    Record<string, { readonly request: string; readonly record: StateRecord }>
  >
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
  /** Trusted authenticated request identity, independent of all submitted owner/scope fields. */
  readonly resolveOwner: (scope: string, signal: AbortSignal) => Promise<string>
  readonly repository: UserContextRepository
  /** Resolve identity from the authenticated request, never from client-supplied scope alone. */
  readonly authorize: (scope: string, id: string, operation: 'read' | 'write') => Promise<void>
}
export function createUserContextBackend(options: UserContextBackendOptions) {
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
    async hydrate(
      scope: string,
      ids: readonly string[],
      signal: AbortSignal,
    ): Promise<readonly StateRecord[]> {
      assertScope(scope)
      if (!validOwnerIds(ids))
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
    async write(operation: StateWrite, signal: AbortSignal): Promise<StateRecord> {
      const { scope, id, expectedRevision, operationId, value } = operation
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
      if (
        typeof operationId !== 'string' ||
        !operationId ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0 ||
        expectedRevision >= Number.MAX_SAFE_INTEGER
      )
        throw new UserContextError('invalid-value', id, 'Invalid write envelope')
      assertOwnerValue(value, id)
      const patch = structuredClone(value)
      const request = stableJson(operation)
      const stored = await options.repository.transact(
        scope,
        id,
        current => {
          if (current) assertStored(current, id)
          const receipt =
            current && Object.hasOwn(current.receipts, operationId)
              ? current.receipts[operationId]
              : undefined
          if (receipt && current) {
            if (receipt.request !== request)
              throw new UserContextError(
                'invalid-value',
                id,
                'Operation ID reused for a different intention',
              )
            return current
          }
          if ((current?.revision ?? 0) !== expectedRevision)
            throw new UserContextError(
              'conflict',
              id,
              'Record changed since this intention was formed; refresh and choose again',
            )
          const next = mergeStateValue(current?.value, patch)
          const record = { id, revision: expectedRevision + 1, value: next }
          return {
            revision: record.revision,
            value: next,
            receipts: { ...current?.receipts, [operationId]: { request, record } },
          }
        },
        signal,
      )
      // A retried operation returns its original acceptance, not a newer operation's record.
      const receipt = Object.hasOwn(stored.receipts, operationId)
        ? stored.receipts[operationId]
        : undefined
      if (!receipt)
        throw new UserContextError(
          'persistence-failed',
          id,
          'Repository did not commit the operation receipt',
        )
      return structuredClone(receipt.record)
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

/** Persistence validates the JSON envelope only; each client owns its domain schema. */
function assertOwnerValue(value: unknown, id: string): asserts value is Record<string, Json> {
  assertJson(value, id)
  if (!isObject(value))
    throw new UserContextError('invalid-value', id, 'An owner value must be a JSON object')
}

function assertStored(stored: StoredState, id: string): void {
  if (!Number.isSafeInteger(stored.revision) || stored.revision < 1 || !isObject(stored.receipts))
    throw new UserContextError('invalid-value', id, 'Invalid stored record metadata')
  assertOwnerValue(stored.value, id)
}

function validOwnerIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((id: unknown) => isValidDefinitionId(id))
}
