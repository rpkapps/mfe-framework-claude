import { describe, expect, it, vi } from 'vitest'
import { isMfeError } from '@company/mfe-core'
import {
  stateCapabilities,
  type UserContextAdapter,
  type UserContextRequirements,
  type StateContract,
  type StateRecord,
  type StateWrite,
} from '@company/mfe-core/user-context'
import { createTestUserContextRepository } from '../testing/user-context.ts'
import { createUserContextBackend } from './backend.ts'
import { UserContextRuntime } from './store.ts'

const owner: StateContract = {
  formatVersion: 1,
  id: 'owner-app',
  revision: 'v2',
  node: {
    kind: 'object',
    strict: true,
    fields: {
      units: {
        kind: 'default',
        inner: { kind: 'enum', values: ['metric', 'imperial'] },
        value: 'metric',
      },
      selection: {
        kind: 'default',
        value: null,
        inner: {
          kind: 'nullable',
          inner: {
            kind: 'object',
            strict: true,
            fields: {
              well: { kind: 'string' },
              run: { kind: 'nullable', inner: { kind: 'string' } },
              comparison: { kind: 'default', inner: { kind: 'string' }, value: 'baseline' },
            },
          },
        },
      },
    },
  },
}
const other: StateContract = { ...owner, id: 'other-app' }
const schema = { formatVersion: 1 as const, contracts: [owner, other] }
function refs(
  contracts: readonly StateContract[] = [owner],
  ownerId = owner.id,
): UserContextRequirements {
  return {
    protocolVersion: 1,
    ownerId,
    contracts: contracts.map(contract => ({
      id: contract.id,
      revision: contract.revision,
      capabilities: stateCapabilities(contract.node),
    })),
  }
}
function setup(override?: (adapter: UserContextAdapter) => UserContextAdapter) {
  const storage = createTestUserContextRepository()
  const authorize = vi.fn(async (_scope: string, _id: string, _operation: 'read' | 'write') => {})
  const backend = createUserContextBackend({
    schema,
    repository: storage.repository,
    authorize,
    resolveOwner: async () => owner.id,
  })
  const adapter = override ? override(backend) : backend
  const onError = vi.fn()
  const runtime = new UserContextRuntime({
    scope: 'tenant/user/workspace',
    schema,
    adapter,
    onError,
  })
  return { ...storage, backend, runtime, adapter, authorize, onError }
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
const signal = () => new AbortController().signal
const record = (revision: number, units = 'metric'): StateRecord => ({
  id: owner.id,
  revision,
  ...(revision ? { value: { units, selection: null } } : {}),
})

describe('definition-owned user context', () => {
  it('hydrates defaults without writes, separates owner slices, and persists own fields', async () => {
    const { runtime, records } = setup()
    await runtime.prepare(refs([owner, other]))
    const own = runtime.bind(owner.id, refs([owner, other]))
    const foreign = runtime.bindReadOnly(owner.id, refs([owner, other]), other.id)
    expect(own.get('units')).toBe('metric')
    expect(records.size).toBe(0)
    expect(await own.set('units', 'imperial')).toEqual({ ok: true, value: 'imperial' })
    expect(own.get('units')).toBe('imperial')
    expect(foreign.get('units')).toBe('metric')
    expect(foreign).not.toHaveProperty('set')
    runtime.dispose()
  })

  it('rejects spoofed requirement ownership and undeclared cross-owner reads', async () => {
    const { runtime } = setup()
    await runtime.prepare(refs([owner, other]))
    expect(() => runtime.bind(other.id, refs())).toThrow('Mounted definition')
    expect(() => runtime.bindReadOnly(owner.id, refs(), other.id).get('units')).toThrow(
      'did not declare',
    )
    const own = runtime.bind(owner.id, refs())
    const result = await own.set(other.id, 'imperial')
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'user-context/unsupported-contract' },
    })
    if (!result.ok) expect(isMfeError(result.error)).toBe(true)
    runtime.dispose()
  })

  it('reads and notifies only after durable acceptance and returns canonical values', async () => {
    const acceptance = deferred<StateRecord>()
    const { runtime } = setup(adapter => ({ ...adapter, write: () => acceptance.promise }))
    await runtime.prepare(refs())
    const store = runtime.bind(owner.id, refs())
    const listener = vi.fn()
    const observer = vi.fn()
    store.subscribe('units', listener)
    store.observe(observer)
    const previous = store.getSnapshot()
    const pending = store.set('units', 'imperial')
    expect(store.get('units')).toBe('metric')
    expect(store.getSnapshot()).toBe(previous)
    expect(listener).not.toHaveBeenCalled()
    expect(observer).not.toHaveBeenCalled()
    acceptance.resolve(record(1, 'imperial'))
    expect(await pending).toEqual({ ok: true, value: 'imperial' })
    expect(listener).toHaveBeenCalledOnce()
    expect(observer).toHaveBeenCalledOnce()
    expect(store.get('units')).toBe('imperial')
    expect(Object.isFrozen(store.getSnapshot())).toBe(true)
    runtime.dispose()
  })

  it('leaves committed state and subscriptions unchanged on validation and persistence failures', async () => {
    const { runtime } = setup(adapter => ({
      ...adapter,
      write: async () => {
        throw new Error('denied')
      },
    }))
    await runtime.prepare(refs())
    const store = runtime.bind(owner.id, refs())
    const listener = vi.fn()
    store.observe(listener)
    expect(await store.set('units', 'bogus')).toMatchObject({
      ok: false,
      error: { code: 'user-context/invalid-value' },
    })
    expect(await store.set('units', 'imperial')).toMatchObject({
      ok: false,
      error: { code: 'user-context/persistence-failed' },
    })
    await vi.waitFor(() =>
      expect(runtime.inspection.getSnapshot().entries[0]?.pendingWrites).toBe(0),
    )
    expect(store.get('units')).toBe('metric')
    expect(listener).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('serializes overlapping writes across different fields at the owner-slice revision', async () => {
    const gates = [deferred<StateRecord>(), deferred<StateRecord>()]
    const writes: StateWrite[] = []
    const { runtime } = setup(adapter => ({
      ...adapter,
      write: operation => {
        writes.push(operation)
        return gates[writes.length - 1]!.promise
      },
    }))
    await runtime.prepare(refs())
    const store = runtime.bind(owner.id, refs())
    const first = store.set('units', 'imperial')
    const second = store.set('selection', { well: '42', run: null })
    expect(writes).toHaveLength(1)
    gates[0]!.resolve(record(1, 'imperial'))
    await first
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    expect(writes.map(write => write.expectedRevision)).toEqual([0, 1])
    gates[1]!.resolve({
      id: owner.id,
      revision: 2,
      value: { units: 'imperial', selection: { well: '42', run: null, comparison: 'canonical' } },
    })
    expect(await second).toEqual({
      ok: true,
      value: { well: '42', run: null, comparison: 'canonical' },
    })
    expect(store.get('units')).toBe('imperial')
    runtime.dispose()
  })

  it('accepts a consumer declaring only a compatible nested subset of an owner', async () => {
    const { runtime } = setup()
    const subset: StateContract = {
      ...owner,
      revision: 'selection-well-reader',
      node: {
        kind: 'object',
        strict: false,
        fields: {
          selection: {
            kind: 'nullable',
            inner: { kind: 'object', strict: false, fields: { well: { kind: 'string' } } },
          },
        },
      },
    }
    const requirements = refs([subset], 'reader-widget')
    await runtime.prepare(requirements)
    const reader = runtime.bindReadOnly<{ selection: { well: string } | null }>(
      'reader-widget',
      requirements,
      owner.id,
    )
    expect(reader.get('selection')).toBeNull()
    await runtime.bind(owner.id, refs()).set('selection', { well: '42', run: '7' })
    expect(reader.get('selection')?.well).toBe('42')
    expect(reader).not.toHaveProperty('set')
    // Subsets describe compatibility and generated types, not a runtime privacy boundary.
    expect(reader.getSnapshot()).toHaveProperty('units', 'metric')
    runtime.dispose()
  })

  it('rejects an incompatible nested consumer field before hydrating', async () => {
    const { runtime, adapter } = setup()
    const hydrate = vi.spyOn(adapter, 'hydrate')
    const incompatible: StateContract = {
      ...owner,
      revision: 'incompatible-reader',
      node: {
        kind: 'object',
        strict: true,
        fields: {
          selection: {
            kind: 'default',
            value: null,
            inner: {
              kind: 'nullable',
              inner: { kind: 'object', strict: true, fields: { well: { kind: 'number' } } },
            },
          },
        },
      },
    }
    await expect(runtime.prepare(refs([incompatible], 'reader-widget'))).rejects.toMatchObject({
      code: 'user-context/unsupported-contract',
    })
    expect(hydrate).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('preserves newer nested fields on older partial updates and replaces arrays/null explicitly', async () => {
    const { runtime } = setup()
    await runtime.prepare(refs())
    const store = runtime.bind(owner.id, refs())
    await store.set('selection', { well: '42', run: '7', comparison: 'overlay' })
    await store.set('selection', { run: '8' })
    expect(store.get('selection')).toEqual({ well: '42', run: '8', comparison: 'overlay' })
    await store.set('selection', null)
    expect(store.get('selection')).toBeNull()
    runtime.dispose()
  })

  it('rejects invalid persisted values instead of silently replacing them with defaults', async () => {
    const { runtime, records } = setup()
    records.set(`tenant/user/workspace/${owner.id}`, {
      revision: 1,
      value: { units: 'invalid', selection: null },
      receipts: {},
    })
    await expect(runtime.prepare(refs())).rejects.toMatchObject({
      code: 'user-context/invalid-value',
    })
    expect(records.get(`tenant/user/workspace/${owner.id}`)?.value).toEqual({
      units: 'invalid',
      selection: null,
    })
    runtime.dispose()
  })

  it('refreshes CAS conflicts without retrying stale intentions', async () => {
    const { runtime, backend, authorize } = setup()
    await runtime.prepare(refs())
    const store = runtime.bind(owner.id, refs())
    await backend.write(
      {
        scope: 'tenant/user/workspace',
        id: owner.id,
        expectedRevision: 0,
        operationId: 'external',
        value: { units: 'imperial' },
      },
      signal(),
    )
    expect(await store.set('units', 'metric')).toMatchObject({
      ok: false,
      error: { code: 'user-context/conflict' },
    })
    await vi.waitFor(() => expect(store.get('units')).toBe('imperial'))
    expect(authorize.mock.calls.filter(call => call[2] === 'write')).toHaveLength(2)
    runtime.dispose()
  })

  it('fails stale scopes, settles pending writes, and ignores late adapter responses', async () => {
    const gate = deferred<StateRecord>()
    const { runtime } = setup(adapter => ({ ...adapter, write: () => gate.promise }))
    await runtime.prepare(refs())
    const old = runtime.bind(owner.id, refs())
    const pending = old.set('units', 'imperial')
    runtime.setScope('new-user')
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: 'user-context/scope-disposed' },
    })
    expect(() => old.get('units')).toThrow('disposed scope')
    await runtime.prepare(refs())
    gate.resolve(record(1, 'imperial'))
    await Promise.resolve()
    expect(runtime.bind(owner.id, refs()).get('units')).toBe('metric')
    runtime.dispose()
  })

  it('notifies stale bindings exactly once on scope invalidation and cleans subscription handlers', async () => {
    const { runtime } = setup()
    await runtime.prepare(refs())
    const mount = new AbortController()
    const remove = vi.spyOn(mount.signal, 'removeEventListener')
    const store = runtime.bind(owner.id, refs(), mount.signal)
    const field = vi.fn()
    const slice = vi.fn()
    store.subscribe('units', field)
    store.observe(slice)
    runtime.setScope('another-user')
    expect(field).toHaveBeenCalledOnce()
    expect(slice).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledTimes(2)
    expect(() => store.getSnapshot()).toThrow('disposed scope')
    runtime.dispose()
    expect(slice).toHaveBeenCalledOnce()
  })

  it('rejects dependent queued intentions after failure without silently rebasing them', async () => {
    const gate = deferred<StateRecord>()
    const write = vi.fn(() => gate.promise)
    const { runtime } = setup(adapter => ({ ...adapter, write }))
    await runtime.prepare(refs())
    const store = runtime.bind(owner.id, refs())
    const first = store.set('units', 'imperial')
    const second = store.set('selection', { well: '42', run: null })
    gate.reject(new Error('denied'))
    expect(await first).toMatchObject({
      ok: false,
      error: { code: 'user-context/persistence-failed' },
    })
    expect(await second).toMatchObject({ ok: false, error: { code: 'user-context/conflict' } })
    expect(write).toHaveBeenCalledOnce()
    expect(store.get('selection')).toBeNull()
    runtime.dispose()
  })

  it('rejects malformed consumer revision metadata before hydration', async () => {
    const { runtime, adapter } = setup()
    const hydrate = vi.spyOn(adapter, 'hydrate')
    for (const revision of ['', undefined, 1]) {
      const malformed = {
        ...refs(),
        contracts: [{ ...refs().contracts[0], revision }],
      } as unknown as UserContextRequirements
      await expect(runtime.prepare(malformed)).rejects.toMatchObject({
        code: 'user-context/unsupported-contract',
      })
    }
    expect(hydrate).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('retains canonical state across mount disposal and supports structural requirements', async () => {
    const { runtime } = setup()
    await runtime.prepare(refs())
    const mount = new AbortController()
    const store = runtime.bind(owner.id, structuredClone(refs()), mount.signal)
    await store.set('units', 'imperial')
    mount.abort()
    expect(() => store.get('units')).toThrow('mount has been disposed')
    expect(await store.set('units', 'metric')).toMatchObject({
      ok: false,
      error: { code: 'user-context/scope-disposed' },
    })
    expect(runtime.bind(owner.id, refs()).get('units')).toBe('imperial')
    runtime.dispose()
  })

  it('does not let delayed hydration or duplicate sync overwrite newer committed revisions', async () => {
    const gate = deferred<readonly StateRecord[]>()
    let publish!: (record: StateRecord) => void
    const { runtime } = setup(adapter => ({
      ...adapter,
      hydrate: () => gate.promise,
      subscribe: (_scope, listener) => {
        publish = listener
        return () => {}
      },
    }))
    const prepared = runtime.prepare(refs())
    publish(record(3, 'imperial'))
    gate.resolve([record(1)])
    await prepared
    const store = runtime.bind(owner.id, refs())
    expect(store.get('units')).toBe('imperial')
    publish(record(2))
    publish(record(3))
    expect(store.get('units')).toBe('imperial')
    runtime.dispose()
  })

  it('returns the original acceptance while preserving a newer synchronized record', async () => {
    const gate = deferred<StateRecord>()
    let publish!: (record: StateRecord) => void
    const { runtime } = setup(adapter => ({
      ...adapter,
      write: () => gate.promise,
      subscribe: (_scope, listener) => {
        publish = listener
        return () => {}
      },
    }))
    await runtime.prepare(refs())
    const store = runtime.bind(owner.id, refs())
    const accepted = store.set('units', 'imperial')
    publish(record(2, 'metric'))
    gate.resolve(record(1, 'imperial'))
    expect(await accepted).toEqual({ ok: true, value: 'imperial' })
    expect(store.get('units')).toBe('metric')
    runtime.dispose()
  })

  it('notifies field and slice subscribers when authoritative validity changes without a value change', async () => {
    let publish!: (record: StateRecord) => void
    const { runtime } = setup(adapter => ({
      ...adapter,
      subscribe: (_scope, listener) => {
        publish = listener
        return () => {}
      },
    }))
    await runtime.prepare(refs())
    const store = runtime.bind(owner.id, refs())
    const field = vi.fn()
    const slice = vi.fn()
    store.subscribe('units', field)
    store.observe(slice)
    publish({ id: owner.id, revision: 1, value: { units: 'invalid', selection: null } })
    expect(field).toHaveBeenCalledOnce()
    expect(slice).toHaveBeenCalledOnce()
    expect(() => store.get('units')).toThrow()
    expect(() => store.getSnapshot()).toThrow()
    publish(record(2, 'metric'))
    expect(field).toHaveBeenCalledTimes(2)
    expect(slice).toHaveBeenCalledTimes(2)
    expect(store.get('units')).toBe('metric')
    runtime.dispose()
  })

  it('supports independently compiled manifests and rejects unsupported consumers before hydration', async () => {
    const { adapter, runtime: initial } = setup()
    initial.dispose()
    const hydrate = vi.fn(adapter.hydrate)
    const runtime = new UserContextRuntime({
      scope: 'scope',
      schema: [
        { formatVersion: 1, contracts: [owner] },
        { formatVersion: 1, contracts: [other] },
      ],
      adapter: { ...adapter, hydrate },
    })
    const requirements = refs()
    const incompatible = {
      ...requirements,
      contracts: requirements.contracts.map(contract => ({
        ...contract,
        capabilities: [...contract.capabilities, 'future-field'],
      })),
    }
    await expect(runtime.prepare(incompatible)).rejects.toMatchObject({
      code: 'user-context/unsupported-contract',
    })
    expect(hydrate).not.toHaveBeenCalled()
    await runtime.prepare(refs([owner, other]))
    expect(hydrate).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })
})

describe('backend owner authorization and durable protocol', () => {
  it('independently rejects a write to another owner even when scope authorization allows it', async () => {
    const { backend, records, authorize } = setup()
    await expect(
      backend.write(
        {
          scope: 'tenant/user/workspace',
          id: other.id,
          expectedRevision: 0,
          operationId: 'spoof',
          value: { units: 'imperial' },
        },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'user-context/unauthorized-owner' })
    expect(records.size).toBe(0)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('enforces scope policy, canonical validation, CAS and idempotent receipt replay', async () => {
    const { backend, records, authorize } = setup()
    const operation: StateWrite = {
      scope: 'tenant/user/workspace',
      id: owner.id,
      expectedRevision: 0,
      operationId: 'one',
      value: { units: 'imperial' },
    }
    const accepted = await backend.write(operation, signal())
    await backend.write(
      {
        ...operation,
        expectedRevision: 1,
        operationId: 'two',
        value: { selection: { well: '42', run: null } },
      },
      signal(),
    )
    expect(await backend.write(operation, signal())).toEqual(accepted)
    expect(records.get(`${operation.scope}/${owner.id}`)?.revision).toBe(2)
    await expect(
      backend.write({ ...operation, value: { units: 'metric' } }, signal()),
    ).rejects.toThrow('reused')
    await expect(
      backend.write({ ...operation, operationId: 'three' }, signal()),
    ).rejects.toMatchObject({ code: 'user-context/conflict' })
    authorize.mockRejectedValueOnce(new Error('forbidden'))
    await expect(
      backend.write({ ...operation, operationId: 'four', expectedRevision: 2 }, signal()),
    ).rejects.toThrow('forbidden')
  })

  it('rejects malformed contracts and requires trusted owner resolution', () => {
    const { repository } = createTestUserContextRepository()
    const options = {
      schema,
      repository,
      authorize: async () => {},
      resolveOwner: async () => owner.id,
    }
    expect(() =>
      createUserContextBackend({ ...options, resolveOwner: undefined } as unknown as Parameters<
        typeof createUserContextBackend
      >[0]),
    ).toThrow()
    for (const contract of [
      { ...owner, id: 'global/path' },
      { ...owner, node: { kind: 'string' } },
      { ...owner, node: { kind: 'object', fields: null, strict: true } },
      { ...owner, node: { ...owner.node, unknownConstraint: true } },
      {
        ...owner,
        node: {
          kind: 'object',
          strict: true,
          fields: { code: { kind: 'string', regex: '^[A-Z]+$' } },
        },
      },
    ]) {
      const malformed = { formatVersion: 1 as const, contracts: [contract as StateContract] }
      expect(() => createUserContextBackend({ ...options, schema: malformed })).toThrow()
      expect(
        () =>
          new UserContextRuntime({
            scope: 'scope',
            schema: malformed,
            adapter: { hydrate: async () => [], write: async () => record(1) },
          }),
      ).toThrow()
    }
  })
})

describe('read-only inspection', () => {
  it('caches immutable snapshots without hydrating or exposing authenticated scope', () => {
    const { runtime, adapter } = setup()
    const hydrate = vi.spyOn(adapter, 'hydrate')
    const first = runtime.inspection.getSnapshot()
    expect(runtime.inspection.getSnapshot()).toBe(first)
    expect(first.entries.map(entry => entry.status)).toEqual(['absent', 'absent'])
    expect(Object.isFrozen(first.entries)).toBe(true)
    expect(first).not.toHaveProperty('scope')
    expect(hydrate).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('reports pending persistence and atomically clears values when scope changes', async () => {
    const gate = deferred<StateRecord>()
    const { runtime } = setup(adapter => ({ ...adapter, write: () => gate.promise }))
    await runtime.prepare(refs())
    const pending = runtime.bind(owner.id, refs()).set('units', 'imperial')
    expect(runtime.inspection.getSnapshot().entries[0]).toMatchObject({
      pendingWrites: 1,
      recordRevision: 0,
      confirmed: { units: 'metric' },
    })
    gate.resolve(record(1, 'imperial'))
    await pending
    expect(runtime.inspection.getSnapshot().entries[0]).toMatchObject({
      pendingWrites: 0,
      recordRevision: 1,
    })
    const snapshots: ReturnType<typeof runtime.inspection.getSnapshot>[] = []
    runtime.inspection.subscribe(() => snapshots.push(runtime.inspection.getSnapshot()))
    runtime.setScope('another-user')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.entries.every(entry => entry.confirmed === undefined)).toBe(true)
    runtime.dispose()
    expect(snapshots.at(-1)).toMatchObject({ generation: 2, disposed: true, entries: [] })
  })
})
