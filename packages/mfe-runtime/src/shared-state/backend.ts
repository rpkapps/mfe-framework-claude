/** Reference server protocol. The repository must transact and commit durably before resolving. */
import {
  applyStateWrite,
  assertJson,
  normalize,
  SharedStateError,
  stableJson,
  type Json,
  type SharedStateManifest,
  type StateContract,
  type StateRecord,
  type StateWrite,
} from '@company/mfe-core/shared-state'

export interface StoredState {
  readonly revision: number
  readonly value: Json
  /** Idempotency receipts retained by the backend for its documented retry window. */
  readonly receipts: Readonly<
    Record<string, { readonly request: string; readonly record: StateRecord }>
  >
}
export interface SharedStateRepository {
  read(scope: string, id: string, signal: AbortSignal): Promise<StoredState | undefined>
  transact(
    scope: string,
    id: string,
    update: (current: StoredState | undefined) => StoredState,
    signal: AbortSignal,
  ): Promise<StoredState>
}
export interface SharedStateBackendOptions {
  readonly contracts: SharedStateManifest
  readonly supportedContracts?: readonly SharedStateManifest[]
  readonly repository: SharedStateRepository
  /** Resolve identity from the authenticated request, never from client-supplied scope alone. */
  readonly authorize: (scope: string, id: string, operation: 'read' | 'write') => Promise<void>
}
export function createSharedStateBackend(options: SharedStateBackendOptions) {
  const canonical = new Map(options.contracts.contracts.map(contract => [contract.id, contract]))
  const contracts = new Map<string, StateContract>()
  for (const manifest of [options.contracts, ...(options.supportedContracts ?? [])])
    for (const contract of manifest.contracts)
      contracts.set(`${contract.id}@${contract.revision}`, contract)
  const find = (id: string): StateContract => {
    const contract = canonical.get(id)
    if (!contract || contract.formatVersion !== 1)
      throw new SharedStateError('unsupported-contract', id, 'Unknown canonical contract')
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
          assertJson(stored.value, id)
          const value = normalize(contract.node, stored.value, id)
          if (value === undefined)
            throw new SharedStateError('invalid-value', id, 'Invalid stored record')
          return { id, revision: stored.revision, value }
        }),
      )
    },
    async write(operation: StateWrite, signal: AbortSignal): Promise<StateRecord> {
      const { scope, id, writerRevision, expectedRevision, operationId, value } = operation
      await options.authorize(scope, id, 'write')
      const contract = find(id)
      const writer = contracts.get(`${id}@${writerRevision}`)
      if (!writer || writer.formatVersion !== 1)
        throw new SharedStateError(
          'unsupported-contract',
          id,
          'Writer revision is outside the support window',
        )
      if (!operationId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new SharedStateError('invalid-value', id, 'Invalid write envelope')
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
              throw new SharedStateError(
                'invalid-value',
                id,
                'Operation ID reused for a different intention',
              )
            return current
          }
          if ((current?.revision ?? 0) !== expectedRevision)
            throw new SharedStateError(
              'conflict',
              id,
              'Record changed since this intention was formed; refresh and choose again',
            )
          const existing = normalize(contract.node, current?.value, id)
          const next = applyStateWrite(contract, writer, existing, value)
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
        throw new SharedStateError(
          'persistence-failed',
          id,
          'Repository did not commit the operation receipt',
        )
      return receipt.record
    },
  }
}
