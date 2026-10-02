import { isValidDefinitionId } from '@company/mfe-core/definition'
/** Reference server protocol. The repository must transact and commit durably before resolving. */
import {
  applyStateWrite,
  assertStateContract,
  immutable,
  assertJson,
  normalize,
  UserContextError,
  stableJson,
  type Json,
  type UserContextManifest,
  type StateContract,
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
  readonly schema: UserContextManifest | readonly UserContextManifest[]
  /** Trusted authenticated request identity, independent of all submitted owner/scope fields. */
  readonly resolveOwner: (scope: string, signal: AbortSignal) => Promise<string>
  readonly repository: UserContextRepository
  /** Resolve identity from the authenticated request, never from client-supplied scope alone. */
  readonly authorize: (scope: string, id: string, operation: 'read' | 'write') => Promise<void>
}
export function createUserContextBackend(options: UserContextBackendOptions) {
  const manifests: readonly UserContextManifest[] = Array.isArray(options.schema)
    ? options.schema
    : [options.schema as UserContextManifest]
  if (
    manifests.some(manifest => manifest.formatVersion !== 1) ||
    typeof options.resolveOwner !== 'function'
  )
    throw new UserContextError(
      'unsupported-contract',
      '<schema>',
      'Supply compiled schema format 1',
    )
  const canonical = new Map<string, StateContract>()
  for (const contract of manifests.flatMap(manifest => manifest.contracts)) {
    assertStateContract(contract)
    if (
      contract.formatVersion !== 1 ||
      !isValidDefinitionId(contract.id) ||
      canonical.has(contract.id) ||
      !isObjectSlice(contract.node)
    )
      throw new UserContextError(
        'unsupported-contract',
        contract.id,
        'Schema needs one current contract per state ID in format 1',
      )
    canonical.set(contract.id, immutable(structuredClone(contract)))
  }
  const find = (id: string): StateContract => {
    const contract = canonical.get(id)
    if (!contract || contract.formatVersion !== 1)
      throw new UserContextError('unsupported-contract', id, 'Unknown canonical contract')
    return contract
  }
  return {
    async hydrate(
      scope: string,
      ids: readonly string[],
      signal: AbortSignal,
    ): Promise<readonly StateRecord[]> {
      return await Promise.all(
        ids.map(async id => {
          await options.authorize(scope, id, 'read')
          const contract = find(id)
          const stored = await options.repository.read(scope, id, signal)
          if (!stored) return { id, revision: 0 }
          if (!Number.isSafeInteger(stored.revision) || stored.revision < 1)
            throw new UserContextError('invalid-value', id, 'Invalid stored record revision')
          assertJson(stored.value, id)
          const value = normalize(contract.node, stored.value, id)
          if (value === undefined)
            throw new UserContextError('invalid-value', id, 'Invalid stored record')
          return { id, revision: stored.revision, value }
        }),
      )
    },
    async write(operation: StateWrite, signal: AbortSignal): Promise<StateRecord> {
      const { scope, id, expectedRevision, operationId, value } = operation
      const ownerId = await options.resolveOwner(scope, signal)
      if (!isValidDefinitionId(ownerId) || ownerId !== id)
        throw new UserContextError(
          'unauthorized-owner',
          id,
          'Only the authenticated owner may write this slice',
        )
      await options.authorize(scope, id, 'write')
      const contract = find(id)
      if (!operationId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new UserContextError('invalid-value', id, 'Invalid write envelope')
      assertJson(value, id)
      const request = stableJson(operation)
      const stored = await options.repository.transact(
        scope,
        id,
        current => {
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
          const existing = normalize(contract.node, current?.value, id)
          const next = applyStateWrite(contract, existing, value)
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
      const receipt = stored.receipts[operationId]
      if (!receipt)
        throw new UserContextError(
          'persistence-failed',
          id,
          'Repository did not commit the operation receipt',
        )
      return receipt.record
    },
  }
}

function isObjectSlice(node: StateContract['node']): boolean {
  return node.kind === 'object' || (node.kind === 'default' && isObjectSlice(node.inner))
}
