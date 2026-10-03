import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { isMfeError } from '@company/mfe-core'
import type {
  StateRecord,
  StateWrite,
  UserContextAdapter,
  UserContextOwner,
} from '@company/mfe-core/user-context'
import {
  createTestUserContextRepository,
  scopedUserContextAdapter,
} from '../testing/user-context.ts'
import { createUserContextBackend } from './backend.ts'
import { UserContextRuntime } from './store.ts'

const schema = z.object({
  units: z.enum(['metric', 'imperial']).default('metric'),
  selection: z
    .strictObject({
      well: z.string(),
      run: z.string().nullable(),
      comparison: z.string().default('baseline'),
    })
    .nullable()
    .default(null),
})
const owner: UserContextOwner = { id: 'owner-app', userContext: { schema } }
const other: UserContextOwner = { id: 'other-app', userContext: { schema } }
/** Reads both slices: its own and only the units of the other owner. */
const reader: UserContextOwner = {
  id: 'owner-app',
  userContext: {
    schema,
    reads: { 'other-app': z.object({ units: z.enum(['metric', 'imperial']).default('metric') }) },
  },
}

function setup(override?: (adapter: UserContextAdapter) => UserContextAdapter) {
  const storage = createTestUserContextRepository()
  const backend = createUserContextBackend({
    repository: storage.repository,
    authorize: async () => {},
    resolveOwner: async () => owner.id,
  })
  const scoped = scopedUserContextAdapter(backend, 'tenant/user')
  const adapter = override ? override(scoped) : scoped
  const onError = vi.fn()
  const runtime = new UserContextRuntime({ adapter, onError })
  return { ...storage, backend, runtime, adapter, onError }
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
const record = (revision: number, units = 'metric'): StateRecord => ({
  id: owner.id,
  revision,
  ...(revision ? { value: { units } } : {}),
})

describe('definition-owned user context', () => {
  it('hydrates defaults without writes, separates owner slices, and persists own fields', async () => {
    const { runtime, records } = setup()
    await runtime.prepare(reader)
    const own = runtime.bind(reader)
    const foreign = runtime.bindReadOnly(reader, other.id)
    expect(own.getSnapshot()).toEqual({ units: 'metric', selection: null })
    expect(records.size).toBe(0)
    expect(await own.set('units', 'imperial')).toEqual({ ok: true, value: 'imperial' })
    expect(own.get('units')).toBe('imperial')
    expect(foreign.get('units')).toBe('metric')
    expect(foreign).not.toHaveProperty('set')
    expect(records.get('tenant/user/owner-app')).toEqual({
      revision: 1,
      value: { units: 'imperial' },
    })
    runtime.dispose()
  })

  it('binds only the declared schema, owners and fields', async () => {
    const { runtime } = setup()
    await runtime.prepare(owner)
    expect(() => runtime.bindReadOnly(owner, other.id)).toThrow(
      "did not declare userContext.reads['other-app']",
    )
    expect(() => runtime.bindReadOnly(reader, reader.id)).toThrow('did not declare')
    expect(() => runtime.bind({ id: 'reads-only', userContext: { reads: {} } })).toThrow(
      'Declare userContext.schema',
    )
    await expect(
      runtime.prepare({ id: 'self-reader', userContext: { reads: { 'self-reader': schema } } }),
    ).rejects.toMatchObject({ code: 'user-context/undeclared' })
    const result = await runtime.bind(owner).set('surprise' as 'units', 'imperial')
    expect(result).toMatchObject({ ok: false, error: { code: 'user-context/undeclared' } })
    if (!result.ok) expect(isMfeError(result.error)).toBe(true)
    runtime.dispose()
  })

  it('reads and notifies only after the server accepts a write, returning the parsed value', async () => {
    const acceptance = deferred<StateRecord>()
    const { runtime } = setup(adapter => ({ ...adapter, write: () => acceptance.promise }))
    await runtime.prepare(owner)
    const store = runtime.bind(owner)
    const listener = vi.fn()
    const observer = vi.fn()
    store.subscribe('units', listener)
    store.observe(observer)
    const previous = store.getSnapshot()
    const pending = store.set('units', 'imperial')
    expect(store.get('units')).toBe('metric')
    expect(store.getSnapshot()).toBe(previous)
    expect(listener).not.toHaveBeenCalled()
    acceptance.resolve(record(1, 'imperial'))
    expect(await pending).toEqual({ ok: true, value: 'imperial' })
    expect(listener).toHaveBeenCalledOnce()
    expect(observer).toHaveBeenCalledOnce()
    expect(store.get('units')).toBe('imperial')
    expect(Object.isFrozen(store.getSnapshot())).toBe(true)
    runtime.dispose()
  })

  it('rejects an invalid value before sending it', async () => {
    const { runtime, adapter } = setup(scoped => ({ ...scoped, write: vi.fn(scoped.write) }))
    await runtime.prepare(owner)
    const store = runtime.bind(owner)
    const result = await store.set('units', 'bogus')
    expect(result).toMatchObject({ ok: false, error: { code: 'user-context/invalid-value' } })
    if (!result.ok) expect(result.error.message).toContain('units: Invalid option')
    expect(await store.set('units', Number.NaN as never)).toMatchObject({
      ok: false,
      error: { code: 'user-context/invalid-value' },
    })
    expect(adapter.write).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('rejects only the failed write and reads the owner again', async () => {
    const hydrate = vi.fn<UserContextAdapter['hydrate']>()
    const { runtime, onError } = setup(adapter => ({
      hydrate: hydrate.mockImplementation(adapter.hydrate),
      write: async write => {
        if (write.value['units'] === 'imperial') throw new Error('denied')
        return await adapter.write(write, new AbortController().signal)
      },
    }))
    await runtime.prepare(owner)
    const store = runtime.bind(owner)
    const listener = vi.fn()
    store.observe(listener)
    const failed = store.set('units', 'imperial')
    const next = store.set('selection', { well: '42', run: null })
    expect(await failed).toMatchObject({
      ok: false,
      error: { code: 'user-context/persistence-failed', message: 'owner-app: denied' },
    })
    expect(await next).toEqual({
      ok: true,
      value: { well: '42', run: null, comparison: 'baseline' },
    })
    expect(onError).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2))
    expect(store.getSnapshot()).toEqual({
      units: 'metric',
      selection: { well: '42', run: null, comparison: 'baseline' },
    })
    runtime.dispose()
  })

  it('sends one owner key at a time, as a patch, in the order the writes were made', async () => {
    const gates = [deferred<StateRecord>(), deferred<StateRecord>()]
    const writes: StateWrite[] = []
    const { runtime } = setup(adapter => ({
      ...adapter,
      write: write => {
        writes.push(write)
        return gates[writes.length - 1]!.promise
      },
    }))
    await runtime.prepare(owner)
    const store = runtime.bind(owner)
    const first = store.set('units', 'imperial')
    const second = store.set('selection', { well: '42', run: null })
    await Promise.resolve()
    expect(writes).toEqual([{ id: owner.id, value: { units: 'imperial' } }])
    gates[0]!.resolve(record(1, 'imperial'))
    await first
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[1]).toEqual({ id: owner.id, value: { selection: { well: '42', run: null } } })
    gates[1]!.resolve({
      id: owner.id,
      revision: 2,
      value: { units: 'imperial', selection: { well: '42', run: null } },
    })
    expect(await second).toMatchObject({ ok: true })
    expect(store.get('units')).toBe('imperial')
    runtime.dispose()
  })

  it('completes a nested update from what the tab reads and sends the key whole', async () => {
    const writes: StateWrite[] = []
    const { runtime, records } = setup(adapter => ({
      ...adapter,
      write: (write, signal) => {
        writes.push(write)
        return adapter.write(write, signal)
      },
    }))
    await runtime.prepare(owner)
    const store = runtime.bind(owner)
    await store.set('selection', { well: '42', run: 'one' })
    expect(await store.set('selection', { run: 'two' })).toEqual({
      ok: true,
      value: { well: '42', run: 'two', comparison: 'baseline' },
    })
    expect(writes[1]).toEqual({
      id: owner.id,
      value: { selection: { well: '42', run: 'two', comparison: 'baseline' } },
    })
    expect(records.get(`tenant/user/${owner.id}`)?.revision).toBe(2)
    runtime.dispose()
  })

  it('lets a reader declare a nested subset with its own defaults', async () => {
    const { runtime, records } = setup()
    records.set('tenant/user/other-app', {
      revision: 3,
      value: { units: 'imperial', selection: { well: '7', run: null }, future: true },
    })
    const consumer: UserContextOwner = {
      id: 'consumer',
      userContext: {
        reads: {
          'other-app': z.object({
            selection: z.object({ well: z.string() }).nullable(),
            missing: z.string().default('fallback'),
          }),
        },
      },
    }
    await runtime.prepare(consumer)
    expect(runtime.bindReadOnly(consumer, other.id).getSnapshot()).toEqual({
      selection: { well: '7' },
      missing: 'fallback',
    })
    runtime.dispose()
  })

  it('explains how to fix a reader whose required field the owner has not written', async () => {
    const { runtime } = setup()
    const consumer: UserContextOwner = {
      id: 'consumer',
      userContext: { reads: { 'other-app': z.object({ units: z.string() }) } },
    }
    await runtime.prepare(consumer)
    expect(() => runtime.bindReadOnly(consumer, other.id).get('units')).toThrow(
      /units: Invalid input.*Give a field the owner may not have written yet a default/,
    )
    runtime.dispose()
  })

  it('marks a stored record the owner schema rejects as invalid', async () => {
    const { runtime, records, onError } = setup()
    records.set('tenant/user/owner-app', { revision: 2, value: { units: 'kelvin' } })
    await expect(runtime.prepare(owner)).rejects.toMatchObject({
      code: 'user-context/invalid-value',
    })
    expect(runtime.inspection.getSnapshot().entries[0]).toMatchObject({
      id: owner.id,
      status: 'invalid',
      value: undefined,
    })
    expect(() => runtime.bind(owner).getSnapshot()).toThrow('units')
    expect(onError).toHaveBeenCalledOnce()
    runtime.dispose()
  })

  it('refuses a schema whose output is not JSON', async () => {
    const { runtime } = setup()
    const dated: UserContextOwner = {
      id: 'dated',
      userContext: {
        schema: z.object({
          at: z
            .string()
            .default('2026-01-01')
            .transform(s => new Date(s)),
        }),
      },
    }
    await expect(runtime.prepare(dated)).rejects.toThrow('must be finite JSON data')
    runtime.dispose()
  })

  it('never lets a late or duplicate record replace a newer revision', async () => {
    const hydration = deferred<readonly StateRecord[]>()
    let push: ((record: StateRecord) => void) | undefined
    const { runtime } = setup(adapter => ({
      ...adapter,
      hydrate: () => hydration.promise,
      subscribe: listener => {
        push = listener
        return () => {}
      },
    }))
    const prepared = runtime.prepare(owner)
    push?.(record(4, 'imperial'))
    hydration.resolve([record(3, 'metric')])
    await prepared
    const store = runtime.bind(owner)
    expect(store.get('units')).toBe('imperial')
    push?.(record(4, 'metric'))
    push?.(record(2, 'metric'))
    expect(store.get('units')).toBe('imperial')
    push?.(record(5, 'metric'))
    expect(store.get('units')).toBe('metric')
    runtime.dispose()
  })

  it('keeps a newer synchronized record when a write answers late', async () => {
    const acceptance = deferred<StateRecord>()
    let push: ((record: StateRecord) => void) | undefined
    const { runtime } = setup(adapter => ({
      ...adapter,
      write: () => acceptance.promise,
      subscribe: listener => {
        push = listener
        return () => {}
      },
    }))
    await runtime.prepare(owner)
    const store = runtime.bind(owner)
    const pending = store.set('units', 'imperial')
    push?.(record(2, 'metric'))
    acceptance.resolve(record(1, 'imperial'))
    expect(await pending).toEqual({ ok: true, value: 'metric' })
    expect(store.get('units')).toBe('metric')
    runtime.dispose()
  })

  it('fails old bindings, writes and late responses closed after a reset', async () => {
    const acceptance = deferred<StateRecord>()
    const { runtime } = setup(adapter => ({ ...adapter, write: () => acceptance.promise }))
    await runtime.prepare(owner)
    const store = runtime.bind(owner)
    const listener = vi.fn()
    store.observe(listener)
    const pending = store.set('units', 'imperial')
    runtime.reset()
    expect(listener).toHaveBeenCalledOnce()
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: 'user-context/scope-disposed' },
    })
    acceptance.resolve(record(1, 'imperial'))
    expect(() => store.get('units')).toThrow('previous signed-in user')
    expect(runtime.inspection.getSnapshot().entries).toEqual([])
    await runtime.prepare(owner)
    expect(runtime.bind(owner).get('units')).toBe('metric')
    expect(() => store.observe(() => {})).toThrow('previous signed-in user')
    runtime.dispose()
  })

  it('unsubscribes a mount when its signal aborts and keeps the record for others', async () => {
    const { runtime } = setup()
    await runtime.prepare(owner)
    const controller = new AbortController()
    const mounted = runtime.bind(owner, controller.signal)
    const listener = vi.fn()
    mounted.observe(listener)
    controller.abort()
    expect(() => mounted.get('units')).toThrow('The mount has been disposed')
    const again = runtime.bind(owner)
    expect(await again.set('units', 'imperial')).toMatchObject({ ok: true })
    expect(listener).not.toHaveBeenCalled()
    runtime.dispose()
  })
})

describe('read-only inspection', () => {
  it('caches snapshots without hydrating, and shows the stored record and owner schema', async () => {
    const { runtime, records } = setup()
    const first = runtime.inspection.getSnapshot()
    expect(first).toEqual({ generation: 0, disposed: false, entries: [] })
    expect(runtime.inspection.getSnapshot()).toBe(first)
    records.set('tenant/user/owner-app', { revision: 2, value: { units: 'imperial' } })
    const listener = vi.fn()
    runtime.inspection.subscribe(listener)
    await runtime.prepare(owner)
    expect(listener).toHaveBeenCalled()
    const [entry] = runtime.inspection.getSnapshot().entries
    expect(entry).toMatchObject({
      id: owner.id,
      status: 'ready',
      revision: 2,
      value: { units: 'imperial' },
      error: undefined,
    })
    expect(entry?.schema).toMatchObject({ properties: { units: { default: 'metric' } } })
    expect(JSON.stringify(runtime.inspection.getSnapshot())).not.toContain('tenant/user')
    runtime.reset()
    expect(runtime.inspection.getSnapshot()).toMatchObject({ generation: 1, entries: [] })
    runtime.dispose()
    expect(runtime.inspection.getSnapshot().disposed).toBe(true)
  })
})
