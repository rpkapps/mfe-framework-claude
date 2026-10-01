import { describe, expect, it, vi } from 'vitest'
import { stateCapabilities } from '@company/mfe-core/shared-state'
import type {
  SharedStateAdapter,
  StateContract,
  StateRecord,
  StateWrite,
} from '@company/mfe-core/shared-state'
import { createTestSharedStateRepository } from '../testing/shared-state.ts'
import { createSharedStateBackend } from './backend.ts'
import { SharedStateRuntime } from './store.ts'

const old: StateContract = {
  formatVersion: 1,
  id: 'selection',
  revision: 'old',
  node: {
    kind: 'default',
    value: null,
    inner: {
      kind: 'nullable',
      inner: {
        kind: 'object',
        strict: true,
        fields: {
          wellId: { kind: 'string' },
          runId: { kind: 'nullable', inner: { kind: 'string' } },
        },
      },
    },
  },
}
const current: StateContract = {
  ...old,
  revision: 'new',
  node: {
    kind: 'default',
    value: null,
    inner: {
      kind: 'nullable',
      inner: {
        kind: 'object',
        strict: true,
        fields: {
          wellId: { kind: 'string' },
          runId: { kind: 'nullable', inner: { kind: 'string' } },
          comparison: { kind: 'default', inner: { kind: 'string' }, value: 'baseline' },
        },
      },
    },
  },
}
const units: StateContract = {
  formatVersion: 1,
  id: 'units',
  revision: 'units',
  node: {
    kind: 'default',
    inner: { kind: 'enum', values: ['metric', 'imperial'] },
    value: 'metric',
  },
}
const contracts = { formatVersion: 1 as const, contracts: [current, units] }
const refs = (contract: StateContract) => ({
  protocolVersion: 1 as const,
  contracts: [
    {
      id: contract.id,
      revision: contract.revision,
      capabilities: stateCapabilities(contract.node),
    },
  ],
})
function setup(adapterOverride?: (adapter: SharedStateAdapter) => SharedStateAdapter) {
  const storage = createTestSharedStateRepository()
  const authorize = vi.fn((_scope: string, _id: string, _operation: 'read' | 'write') =>
    Promise.resolve(),
  )
  const backend = createSharedStateBackend({
    schema: contracts,
    repository: storage.repository,
    authorize,
  })
  const adapter = adapterOverride ? adapterOverride(backend) : backend
  const onError = vi.fn()
  const runtime = new SharedStateRuntime({
    scope: 'tenant/user/workspace',
    schema: contracts,
    adapter,
    onError,
  })
  return { ...storage, backend, adapter, runtime, authorize, onError }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('shell-owned shared state', () => {
  it('rejects consumers requiring fields unavailable in an older shell before hydration', async () => {
    const { adapter, runtime: original } = setup()
    original.dispose()
    const hydrate = vi.fn(adapter.hydrate)
    const runtime = new SharedStateRuntime({
      scope: 'scope',
      schema: { formatVersion: 1, contracts: [old] },
      adapter: { ...adapter, hydrate },
    })
    await expect(runtime.prepare(refs(current))).rejects.toMatchObject({
      code: 'shared-state/unsupported-contract',
    })
    expect(() => runtime.bind(refs(current))).toThrow('required consumer fields')
    expect(hydrate).not.toHaveBeenCalled()
    runtime.dispose()
  })
  it('rejects consumers whose validation constraints differ from the shell schema', () => {
    const { runtime } = setup()
    const different: StateContract = {
      ...units,
      node: {
        kind: 'default',
        value: 'metric',
        inner: { kind: 'enum', values: ['metric', 'imperial', 'other'] },
      },
    }
    expect(() => runtime.bind(refs(different))).toThrow('required consumer fields')
    runtime.dispose()
  })
  for (const initialValue of [null, { wellId: '42', runId: '0', comparison: 'overlay' }])
    it(`settles accepted and dependent queued writes after a remote reset from ${initialValue === null ? 'absent state' : 'an existing record'}`, async () => {
      const acceptance = deferred<StateRecord>()
      let publish!: (record: StateRecord) => void
      let record: StateRecord =
        initialValue === null
          ? { id: 'selection', revision: 0 }
          : { id: 'selection', revision: 1, value: initialValue }
      const runtime = new SharedStateRuntime({
        scope: 'scope',
        schema: contracts,
        adapter: {
          hydrate: async () => [record],
          subscribe: (_scope, listener) => {
            publish = listener
            return () => undefined
          },
          write: () => acceptance.promise,
        },
      })
      await runtime.prepare(refs(current))
      const store = runtime.bind(refs(current))
      const first = store.set(
        'selection',
        initialValue === null ? { wellId: '42', runId: '1' } : { runId: '1' },
      )
      const second = store.set('selection', { runId: '2' })
      const rejected = expect(second).rejects.toMatchObject({ code: 'shared-state/conflict' })
      const acceptedRevision = record.revision + 1
      record = { id: 'selection', revision: acceptedRevision + 1, value: null }
      publish(record)
      acceptance.resolve({
        id: 'selection',
        revision: acceptedRevision,
        value: { wellId: '42', runId: '1', comparison: 'overlay' },
      })
      await expect(first).resolves.toBeUndefined()
      await rejected
      expect(store.get('selection')).toBeNull()
      runtime.dispose()
    })
  it('accepts old consumer revisions using only the latest schema and preserves newer fields', async () => {
    const { runtime, records } = setup()
    await runtime.prepare({
      protocolVersion: 1,
      contracts: [...refs(old).contracts, ...refs(units).contracts],
    })
    const older = runtime.bind<{ selection: { wellId: string; runId: string | null } | null }>(
      refs(old),
    )
    const newer = runtime.bind<{
      selection: { wellId: string; runId: string | null; comparison: string } | null
    }>(refs(current))
    const untouched = vi.fn()
    runtime.bind(refs(units)).subscribe('units', untouched)
    const changed = vi.fn()
    older.subscribe('selection', changed)
    expect(older.get('selection')).toBeNull()
    expect(records.size).toBe(0) // defaults never write on mount
    const initial = newer.set('selection', { wellId: '42', runId: '7', comparison: 'overlay' })
    expect(newer.get('selection')?.comparison).toBe('overlay') // optimistic, before await
    await initial
    const snapshot = older.get('selection')
    expect(snapshot).toEqual({ wellId: '42', runId: '7', comparison: 'overlay' })
    expect(older.get('selection')).toBe(snapshot)
    await older.set('selection', { wellId: '42', runId: '8' })
    expect(newer.get('selection')).toEqual({ wellId: '42', runId: '8', comparison: 'overlay' })
    await newer.set('selection', { runId: '9' })
    expect(newer.get('selection')).toEqual({ wellId: '42', runId: '9', comparison: 'overlay' })
    expect(untouched).not.toHaveBeenCalled()
    expect(changed).toHaveBeenCalled()
    expect(Object.isFrozen(newer.get('selection'))).toBe(true)
    runtime.dispose()
  })
  it('does not publish invalid writes or resolve before persistence acceptance', async () => {
    const acceptance = deferred<StateRecord>()
    const { runtime } = setup(adapter => ({ ...adapter, write: () => acceptance.promise }))
    await runtime.prepare(refs(units))
    const store = runtime.bind<{ units: 'metric' | 'imperial' }>(refs(units))
    const listener = vi.fn()
    store.subscribe('units', listener)
    await expect(store.set('units', 'unknown' as 'metric')).rejects.toMatchObject({
      code: 'shared-state/invalid-value',
    })
    expect(listener).not.toHaveBeenCalled()
    let settled = false
    const pending = store.set('units', 'imperial').then(() => {
      settled = true
    })
    expect(store.get('units')).toBe('imperial')
    await Promise.resolve()
    expect(settled).toBe(false)
    acceptance.resolve({ id: 'units', revision: 1, value: 'imperial' })
    await pending
    expect(settled).toBe(true)
    runtime.dispose()
  })
  it('distinguishes invalid persisted data from absent data and fails hydration without resetting it', async () => {
    const { runtime, records } = setup()
    records.set('tenant/user/workspace/units', { revision: 1, value: 'invalid', receipts: {} })
    await expect(runtime.prepare(refs(units))).rejects.toMatchObject({
      code: 'shared-state/invalid-value',
    })
    expect(records.get('tenant/user/workspace/units')?.value).toBe('invalid')
    expect(() => runtime.bind(refs(units)).get('units')).toThrow()
    runtime.dispose()
  })
  it('refreshes a CAS conflict without retrying stale intent', async () => {
    const { runtime, backend, authorize } = setup()
    await runtime.prepare(refs(units))
    const store = runtime.bind(refs(units))
    await backend.write(
      {
        scope: 'tenant/user/workspace',
        id: 'units',
        expectedRevision: 0,
        operationId: 'external',
        value: 'imperial',
      },
      new AbortController().signal,
    )
    await expect(store.set('units', 'metric')).rejects.toMatchObject({
      code: 'shared-state/conflict',
    })
    await vi.waitFor(() => expect(store.get('units')).toBe('imperial'))
    expect(authorize.mock.calls.filter(call => call[2] === 'write')).toHaveLength(2)
    runtime.dispose()
  })
  it('replays newer optimistic intent when an older response or rejection arrives', async () => {
    const first = deferred<StateRecord>()
    const second = deferred<StateRecord>()
    const writes: StateWrite[] = []
    const { runtime } = setup(adapter => ({
      ...adapter,
      write: operation => {
        writes.push(operation)
        return writes.length === 1 ? first.promise : second.promise
      },
    }))
    await runtime.prepare(refs(units))
    const store = runtime.bind(refs(units))
    const one = store.set('units', 'imperial')
    const rejection = expect(one).rejects.toThrow('denied')
    const two = store.set('units', 'metric')
    first.reject(new Error('denied'))
    await rejection
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    expect(store.get('units')).toBe('metric')
    second.resolve({ id: 'units', revision: 2, value: 'metric' })
    await two
    expect(store.get('units')).toBe('metric')
    runtime.dispose()
  })
  it('rejects pending work and ignores late responses on scope switches, even if the adapter ignores abort', async () => {
    const delayed = deferred<StateRecord>()
    const { runtime } = setup(adapter => ({ ...adapter, write: () => delayed.promise }))
    await runtime.prepare(refs(units))
    const previous = runtime.bind(refs(units))
    const pending = previous.set('units', 'imperial')
    const rejection = expect(pending).rejects.toMatchObject({ code: 'shared-state/scope-disposed' })
    runtime.setScope('different-user/workspace')
    await rejection
    expect(() => previous.get('units')).toThrow('disposed scope')
    await runtime.prepare(refs(units))
    const next = runtime.bind(refs(units))
    delayed.resolve({ id: 'units', revision: 1, value: 'imperial' })
    await Promise.resolve()
    expect(next.get('units')).toBe('metric')
    runtime.dispose()
  })
  it('does not let hydration overwrite a subscription or optimistic write', async () => {
    const delayed = deferred<readonly StateRecord[]>()
    let publish!: (record: StateRecord) => void
    const accepted = deferred<StateRecord>()
    const { runtime } = setup(adapter => ({
      ...adapter,
      hydrate: () => delayed.promise,
      subscribe: (_scope, listener) => {
        publish = listener
        return () => undefined
      },
      write: () => accepted.promise,
    }))
    const hydration = runtime.prepare(refs(units))
    publish({ id: 'units', revision: 3, value: 'imperial' })
    const store = runtime.bind(refs(units))
    const pending = store.set('units', 'metric')
    delayed.resolve([{ id: 'units', revision: 1, value: 'imperial' }])
    await hydration
    expect(store.get('units')).toBe('metric')
    accepted.resolve({ id: 'units', revision: 4, value: 'metric' })
    await pending
    runtime.dispose()
  })
  it('shares the latest snapshot across consumer revisions and keeps unchanged snapshot identity', async () => {
    const { runtime } = setup()
    await runtime.prepare(refs(old))
    const older = runtime.bind(refs(old))
    const newer = runtime.bind(refs(current))
    await newer.set('selection', { wellId: '42', runId: null, comparison: 'a' })
    const snapshot = older.get('selection')
    await newer.set('selection', { wellId: '42', runId: null, comparison: 'b' })
    expect(older.get('selection')).not.toBe(snapshot)
    const updated = older.get('selection')
    await newer.set('selection', { comparison: 'b' })
    expect(older.get('selection')).toBe(updated)
    runtime.dispose()
  })
  it('retains canonical state through binding disposal and remount and supports structural copies', async () => {
    const { runtime } = setup()
    const mount = new AbortController()
    await runtime.prepare(refs(units))
    const service = {
      protocolVersion: 1 as const,
      prepare: runtime.prepare.bind(runtime),
      bind: runtime.bind.bind(runtime),
    }
    const mounted = service.bind(structuredClone(refs(units)), mount.signal)
    await mounted.set('units', 'imperial')
    mount.abort()
    expect(() => mounted.get('units')).toThrow('mount has been disposed')
    expect(service.bind(refs(units)).get('units')).toBe('imperial')
    expect(() =>
      service.bind({ protocolVersion: 2, contracts: [] } as unknown as ReturnType<typeof refs>),
    ).toThrow('protocol 1')
    expect(service.bind(refs({ ...units, revision: 'older' })).get('units')).toBe('imperial')
    expect(() => service.bind(refs({ ...units, id: 'unknown' }))).toThrow('State ID')
    runtime.dispose()
  })
  it('server validates merged updates against the latest schema, enforces authorization and deduplicates receipts', async () => {
    const { backend, records, authorize } = setup()
    const signal = new AbortController().signal
    const operation: StateWrite = {
      scope: 'tenant/user/workspace',
      id: 'selection',
      expectedRevision: 0,
      operationId: '1',
      value: { wellId: '42', runId: '7', comparison: 'overlay' },
    }
    const record = await backend.write(operation, signal)
    await backend.write(
      {
        ...operation,
        operationId: '2',
        expectedRevision: 1,
        value: { wellId: '42', runId: '8' },
      },
      signal,
    )
    expect(await backend.write(operation, signal)).toEqual(record)
    expect(records.get('tenant/user/workspace/selection')?.value).toEqual({
      wellId: '42',
      runId: '8',
      comparison: 'overlay',
    })
    await expect(
      backend.write({ ...operation, id: 'unknown', operationId: '3' }, signal),
    ).rejects.toMatchObject({ code: 'shared-state/unsupported-contract' })
    await expect(backend.write({ ...operation, value: null }, signal)).rejects.toThrow('reused')
    authorize.mockRejectedValueOnce(new Error('forbidden'))
    await expect(backend.write({ ...operation, operationId: '4' }, signal)).rejects.toThrow(
      'forbidden',
    )
  })
})
