/**
 * The `user` area through the one storage API: the shell's adapter is the only thing behind it,
 * so every promise it returns is held here and settled by hand, in the order a slow network would.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  storedKey,
  type StoredRow,
  type StoredValue,
  type UserStorageAdapter,
  type UserStorageHandle,
  type UserStorageState,
} from '@company/mfe-core'

import { createMemoryStorageArea } from '../testing/memory-storage-area.ts'
import { StorageService, type StorageCaller } from './service.ts'
import { MfeStorageStore } from './storage-store.ts'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

interface PendingLoad extends Deferred<UserStorageState> {
  readonly signal: AbortSignal
}

interface PendingSave extends Deferred<StoredRow | null> {
  readonly owner: string
  readonly key: string
  readonly value: StoredValue | null
  readonly signal: AbortSignal
}

/** Every load and save waits until the test settles it. */
function controlledAdapter() {
  const loads: PendingLoad[] = []
  const saves: PendingSave[] = []
  const handles: UserStorageHandle[] = []
  let revision = 10
  const adapter: UserStorageAdapter = {
    load: signal => {
      const load = { ...deferred<UserStorageState>(), signal }
      loads.push(load)
      return load.promise
    },
    save: (owner, key, value, signal) => {
      const save = { ...deferred<StoredRow | null>(), owner, key, value, signal }
      saves.push(save)
      return save.promise
    },
    sync: handle => {
      handles.push(handle)
    },
  }
  /** Settles a save as the server would: the row it stored, with a fresh revision. */
  const accept = (save: PendingSave | undefined): void => {
    if (save === undefined) throw new Error('no save to accept')
    revision += 1
    save.resolve(save.value === null ? null : { ...save.value, revision })
  }
  return { adapter, loads, saves, handles, accept }
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const units = storedKey('units', z.enum(['metric', 'imperial']).default('metric'), {
  storage: 'user',
})
const density = storedKey('density', z.enum(['compact', 'comfortable']).default('comfortable'), {
  storage: 'user',
})

const REPORTS: StorageCaller = { owner: 'reports' }

const services: StorageService[] = []

afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
})

function setup(adapter?: UserStorageAdapter) {
  const control = controlledAdapter()
  const service = new StorageService({
    browser: new MfeStorageStore({
      areas: { local: createMemoryStorageArea(), session: createMemoryStorageArea() },
      eventTarget: null,
    }),
    user: adapter ?? control.adapter,
  })
  services.push(service)
  return { ...control, service, storage: service.forCaller(REPORTS) }
}

/** A service whose load has resolved with `state`. */
async function loaded(state: UserStorageState = {}) {
  const setup_ = setup()
  setup_.loads[0]?.resolve(state)
  await setup_.service.whenLoaded()
  return setup_
}

function row(d: unknown, revision = 1, v = 1): StoredRow {
  return { v, d, revision }
}

describe('loading', () => {
  it('reads the default while loading, then the stored value once loaded', async () => {
    const { service, loads, storage } = setup()
    const binding = service.bind(REPORTS, units)
    const listener = vi.fn()
    binding.subscribe(listener)

    expect(binding.getSnapshot()).toEqual({ value: 'metric', status: 'loading', error: undefined })
    let got: string | undefined
    void storage.get(units).then(value => {
      got = value
    })
    await flush()
    expect(got).toBeUndefined()

    loads[0]?.resolve({ reports: { units: row('imperial') } })
    await flush()

    expect(got).toBe('imperial')
    expect(binding.getSnapshot()).toEqual({ value: 'imperial', status: 'ready', error: undefined })
    expect(listener).toHaveBeenCalled()
  })

  it('falls back to defaults after a failed load, refuses writes, and recovers on retry', async () => {
    const { service, loads, saves, storage } = setup()
    const binding = service.bind(REPORTS, units)
    loads[0]?.reject(new Error('backend down'))
    await service.whenLoaded()

    expect(binding.getSnapshot()).toMatchObject({
      value: 'metric',
      status: 'error',
      error: { code: 'storage/persistence-failed' },
    })
    expect(await storage.get(units)).toBe('metric')
    await expect(binding.set('imperial')).rejects.toMatchObject({ code: 'storage/not-ready' })
    expect(saves).toHaveLength(0)

    const retried = binding.retry()
    expect(binding.getSnapshot().status).toBe('loading')
    expect(loads).toHaveLength(2)
    loads[1]?.resolve({ reports: { units: row('imperial') } })
    await retried

    expect(binding.getSnapshot()).toEqual({ value: 'imperial', status: 'ready', error: undefined })
  })

  it('exposes the failed load and loads again through retryLoad()', async () => {
    const { service, loads } = setup()
    const user = service.user
    if (user === undefined) throw new Error('expected a user store')
    expect(user.loadError).toBeUndefined()
    await user.retryLoad()
    expect(loads).toHaveLength(1)

    loads[0]?.reject(new Error('backend down'))
    await service.whenLoaded()
    expect(user.loadError).toMatchObject({ code: 'storage/persistence-failed' })

    const retried = user.retryLoad()
    expect(loads).toHaveLength(2)
    expect(user.phase).toBe('loading')
    expect(user.loadError).toBeUndefined()
    loads[1]?.resolve({})
    await retried

    expect(user.phase).toBe('ready')
    expect(user.loadError).toBeUndefined()
    await user.retryLoad()
    expect(loads).toHaveLength(2)
  })

  it('reports an adapter that resolves with something other than a state as a failed load', async () => {
    const { service, loads } = setup()
    loads[0]?.resolve(null as unknown as UserStorageState)
    await service.whenLoaded()

    expect(service.bind(REPORTS, units).getSnapshot().status).toBe('error')
  })

  it('reads every user key as an error, not a silent default, when the shell has no adapter', async () => {
    const service = new StorageService({
      browser: new MfeStorageStore({
        areas: { local: createMemoryStorageArea() },
        eventTarget: null,
      }),
    })
    services.push(service)
    const binding = service.bind(REPORTS, units)

    expect(binding.getSnapshot()).toMatchObject({
      value: 'metric',
      status: 'error',
      error: { code: 'storage/not-ready' },
    })
    await expect(binding.set('imperial')).rejects.toMatchObject({ code: 'storage/not-ready' })
  })
})

describe('saving', () => {
  it('shows the new value at once as saving, then ready once the backend stored it', async () => {
    const { service, saves, accept } = await loaded()
    const binding = service.bind(REPORTS, units)

    const saved = binding.set('imperial')

    expect(binding.getSnapshot()).toEqual({ value: 'imperial', status: 'saving', error: undefined })
    expect(saves.map(({ owner, key, value }) => ({ owner, key, value }))).toEqual([
      { owner: 'reports', key: 'units', value: { v: 1, d: 'imperial' } },
    ])
    accept(saves[0])
    await saved

    expect(binding.getSnapshot()).toEqual({ value: 'imperial', status: 'ready', error: undefined })
  })

  it('rolls back a failed save, rejects it, and sends it again on retry', async () => {
    const { service, saves, accept } = await loaded({ reports: { units: row('metric') } })
    const binding = service.bind(REPORTS, units)

    const saved = binding.set('imperial')
    saves[0]?.reject(new Error('503'))

    await expect(saved).rejects.toMatchObject({ code: 'storage/persistence-failed' })
    expect(binding.getSnapshot()).toMatchObject({
      value: 'metric',
      status: 'error',
      error: { code: 'storage/persistence-failed' },
    })

    const retried = binding.retry()
    expect(saves).toHaveLength(2)
    expect(saves[1]?.value).toEqual({ v: 1, d: 'imperial' })
    expect(binding.getSnapshot().status).toBe('saving')
    accept(saves[1])
    await retried

    expect(binding.getSnapshot()).toEqual({ value: 'imperial', status: 'ready', error: undefined })
  })

  it('keeps one save in flight per key and sends only the latest value next', async () => {
    const { service, saves, accept } = await loaded()
    const binding = service.bind(REPORTS, density)
    const settled: string[] = []
    const track = (name: string, promise: Promise<void>) => promise.then(() => settled.push(name))

    const first = track('first', binding.set('compact'))
    const second = track('second', binding.set('comfortable'))
    const third = track('third', binding.set('compact'))

    expect(saves).toHaveLength(1)
    expect(binding.getSnapshot()).toMatchObject({ value: 'compact', status: 'saving' })

    accept(saves[0])
    await first
    expect(settled).toEqual(['first'])
    expect(saves).toHaveLength(2)
    expect(saves[1]?.value).toEqual({ v: 1, d: 'compact' })

    accept(saves[1])
    await Promise.all([second, third])
    expect(settled).toEqual(['first', 'second', 'third'])
    expect(saves).toHaveLength(2)
    expect(binding.getSnapshot()).toMatchObject({ value: 'compact', status: 'ready' })
  })

  it('saves different keys in parallel', async () => {
    const { storage, saves, accept } = await loaded()

    const saved = [storage.set(units, 'imperial'), storage.set(density, 'compact')]

    expect(saves.map(save => save.key)).toEqual(['units', 'density'])
    for (const save of saves) accept(save)
    await Promise.all(saved)
  })

  it('applies a functional update to the value shown, and removes the row on reset', async () => {
    const { storage, saves, accept } = await loaded({ reports: { units: row('metric') } })

    const updated = storage.set(units, previous => (previous === 'metric' ? 'imperial' : 'metric'))
    accept(saves[0])
    await updated
    expect(storage.peek(units)).toBe('imperial')

    const reset = storage.reset(units)
    expect(saves[1]?.value).toBeNull()
    accept(saves[1])
    await reset
    expect(storage.peek(units)).toBe('metric')
    expect(storage.status(units)).toBe('ready')
  })

  it('refuses a value that fails the schema, or is not JSON, without sending anything', async () => {
    const { service, saves, storage } = await loaded()
    const at = storedKey('at', z.any().default(null), { storage: 'user' })

    await expect(storage.set(units, 'si' as 'metric')).rejects.toMatchObject({
      code: 'storage/invalid-value',
    })
    await expect(storage.set(at, new Date())).rejects.toMatchObject({
      code: 'storage/invalid-value',
    })
    expect(saves).toHaveLength(0)
    expect(service.bind(REPORTS, units).getSnapshot().status).toBe('ready')
  })
})

describe('replace', () => {
  it('ignores older revisions, keeps keys with a save in flight, and removes absent keys', async () => {
    const { service, saves, handles, accept } = await loaded({
      reports: { units: row('imperial', 5), density: row('compact', 5) },
    })
    const unitsBinding = service.bind(REPORTS, units)
    const densityBinding = service.bind(REPORTS, density)
    const handle = handles[0]
    if (handle === undefined) throw new Error('sync was not started')

    handle.replace({ reports: { units: row('metric', 4), density: row('compact', 5) } })
    expect(unitsBinding.getSnapshot().value).toBe('imperial')

    handle.replace({ reports: { units: row('metric', 6), density: row('compact', 5) } })
    expect(unitsBinding.getSnapshot().value).toBe('metric')

    const saving = densityBinding.set('comfortable')
    handle.replace({ reports: { units: row('metric', 6) } })
    expect(densityBinding.getSnapshot()).toMatchObject({ value: 'comfortable', status: 'saving' })

    handle.replace({})
    expect(unitsBinding.getSnapshot()).toMatchObject({ value: 'metric', status: 'ready' })
    expect(densityBinding.getSnapshot().value).toBe('comfortable')

    accept(saves[0])
    await saving
    handle.replace({ reports: {} })
    expect(densityBinding.getSnapshot()).toMatchObject({ value: 'comfortable', status: 'ready' })
    expect(unitsBinding.getSnapshot().value).toBe('metric')
  })
})

describe('replace racing saves', () => {
  it('removes a key another tab removed, even right after this tab saved it', async () => {
    const { service, saves, handles, accept } = await loaded()
    const binding = service.bind(REPORTS, units)
    const saving = binding.set('imperial')
    accept(saves[0])
    await saving

    handles[0]?.replace({})
    expect(binding.getSnapshot()).toMatchObject({ value: 'metric', status: 'ready' })
  })

  it('does not bring back a removed row from a state read before the removal', async () => {
    const { service, saves, handles, accept } = await loaded({
      reports: { units: row('imperial', 5) },
    })
    const binding = service.bind(REPORTS, units)
    const removing = binding.reset()
    accept(saves[0])
    await removing

    handles[0]?.replace({ reports: { units: row('imperial', 5) } })
    expect(binding.getSnapshot().value).toBe('metric')

    handles[0]?.replace({ reports: { units: row('imperial', 12) } })
    expect(binding.getSnapshot().value).toBe('imperial')
  })

  it('keeps a newer row another tab wrote while this tab’s removal was in flight', async () => {
    const { service, saves, handles } = await loaded({ reports: { units: row('imperial', 5) } })
    const binding = service.bind(REPORTS, units)
    const removing = binding.reset()
    handles[0]?.replace({ reports: { units: row('imperial', 7) } })
    saves[0]?.resolve(null)
    await removing

    expect(binding.getSnapshot().value).toBe('imperial')
  })
})

describe('changing user', () => {
  it('holds whenLoaded() for the next user’s load when the user changes during a load', async () => {
    const { service, loads, storage } = setup()
    let settled = false
    const waiting = service.whenLoaded().then(() => {
      settled = true
    })
    service.resetUser()
    await flush()
    expect(settled).toBe(false)

    loads[1]?.resolve({ reports: { units: row('imperial') } })
    await waiting
    expect(storage.status(units)).toBe('ready')
    expect(storage.peek(units)).toBe('imperial')
  })

  it('drops the previous user’s values and loads again', async () => {
    const { service, loads, storage } = await loaded({ reports: { units: row('imperial') } })
    expect(storage.peek(units)).toBe('imperial')

    service.resetUser()

    expect(loads[0]?.signal.aborted).toBe(true)
    expect(storage.status(units)).toBe('loading')
    expect(storage.peek(units)).toBe('metric')
    loads[1]?.resolve({ reports: { units: row('metric', 3) } })
    await service.whenLoaded()
    expect(storage.status(units)).toBe('ready')
  })

  it('ignores whatever the previous user’s load and saves resolve with', async () => {
    const { service, loads, saves, storage, accept } = await loaded()
    const inFlight = storage.set(units, 'imperial')
    const queued = storage.set(units, 'metric')

    service.resetUser()

    expect(saves[0]?.signal.aborted).toBe(true)
    await expect(queued).rejects.toMatchObject({ code: 'storage/disposed' })
    accept(saves[0])
    await expect(inFlight).rejects.toMatchObject({ code: 'storage/disposed' })
    expect(storage.peek(units)).toBe('metric')

    // A second switch while the first user's load is still out.
    service.resetUser()
    loads[1]?.resolve({ reports: { units: row('imperial', 9) } })
    await flush()
    expect(storage.status(units)).toBe('loading')
    loads[2]?.resolve({})
    await service.whenLoaded()
    expect(storage.peek(units)).toBe('metric')
    expect(storage.status(units)).toBe('ready')
  })
})

describe('a save the adapter never settles', () => {
  it('rejects its waiters when the user changes, without waiting for the adapter', async () => {
    const { service, saves, storage } = await loaded()
    const inFlight = storage.set(units, 'imperial')

    service.resetUser()

    // The adapter ignores the abort and never settles saves[0].
    expect(saves[0]?.signal.aborted).toBe(true)
    await expect(inFlight).rejects.toMatchObject({ code: 'storage/disposed' })
  })
})

describe('owners and instances', () => {
  it('reads another app’s value through storedKey.from and refuses writes to it', async () => {
    const labUnits = storedKey.from(
      'lab',
      'units',
      z.enum(['metric', 'imperial']).default('metric'),
      {
        storage: 'user',
      },
    )
    const { service, saves, storage } = await loaded({ lab: { units: row('imperial') } })

    expect(storage.peek(labUnits)).toBe('imperial')
    expect(storage.peek(units)).toBe('metric')
    const binding = service.bind(REPORTS, labUnits)
    await expect(binding.set('metric')).rejects.toMatchObject({
      code: 'storage/unauthorized-owner',
    })
    await expect(binding.reset()).rejects.toMatchObject({ code: 'storage/unauthorized-owner' })
    // A reader's retry has nothing of its own to send again.
    await expect(binding.retry()).resolves.toBeUndefined()
    expect(saves).toHaveLength(0)
  })

  it('gives a reader whose schema the owner’s value fails its default, with an error', async () => {
    const labUnits = storedKey.from('lab', 'units', z.enum(['si', 'us']).default('si'), {
      storage: 'user',
    })
    const { service } = await loaded({ lab: { units: row('imperial') } })

    expect(service.bind(REPORTS, labUnits).getSnapshot()).toMatchObject({
      value: 'si',
      status: 'error',
      error: { code: 'storage/invalid-value' },
    })
  })

  it('stores a perInstance key under name@instanceId, and requires the instanceId', async () => {
    const tile = storedKey('tile', z.string().default('small'), {
      storage: 'user',
      perInstance: true,
    })
    const { service, saves, accept } = await loaded({
      board: { 'tile@south': row('large') },
    })

    expect(() => service.bind({ owner: 'board' }, tile)).toThrow(
      expect.objectContaining({ code: 'storage/invalid-value' }),
    )
    expect(() => service.bind({ owner: 'board', instanceId: ' ' }, tile)).toThrow(/instanceId/)

    const north = service.forCaller({ owner: 'board', instanceId: 'north' })
    const south = service.forCaller({ owner: 'board', instanceId: 'south' })
    expect(south.peek(tile)).toBe('large')
    expect(north.peek(tile)).toBe('small')

    const saved = north.set(tile, 'wide')
    expect(saves[0]).toMatchObject({ owner: 'board', key: 'tile@north' })
    accept(saves[0])
    await saved
    expect(north.peek(tile)).toBe('wide')
    expect(south.peek(tile)).toBe('large')
  })

  it('refuses a write after the caller went away', async () => {
    const { service, saves } = await loaded()
    const controller = new AbortController()
    const storage = service.forCaller({ owner: 'reports', signal: controller.signal })
    controller.abort()

    await expect(storage.set(units, 'imperial')).rejects.toMatchObject({
      code: 'storage/disposed',
    })
    await expect(storage.get(units)).rejects.toBeDefined()
    expect(saves).toHaveLength(0)
  })
})

describe('versions', () => {
  const v2 = storedKey('units', z.enum(['metric', 'imperial']).default('metric'), {
    storage: 'user',
    version: 2,
    migrate: (value, from) =>
      from === 1 && value === 'si' ? 'metric' : (value as 'metric' | 'imperial'),
  })

  it('migrates a row written at an older version, and writes the new version back on save', async () => {
    const { storage, saves, accept } = await loaded({ reports: { units: row('si', 1, 1) } })

    expect(storage.peek(v2)).toBe('metric')
    expect(storage.status(v2)).toBe('ready')
    const saved = storage.set(v2, 'imperial')
    expect(saves[0]?.value).toEqual({ v: 2, d: 'imperial' })
    accept(saves[0])
    await saved
  })

  it('reads a row written at a newer version as an error, with the default', async () => {
    const { storage, service } = await loaded({ reports: { units: row('imperial', 1, 3) } })

    expect(storage.peek(v2)).toBe('metric')
    expect(service.bind(REPORTS, v2).getSnapshot()).toMatchObject({
      status: 'error',
      error: {
        code: 'storage/invalid-value',
        message: expect.stringMatching(/version 3/) as unknown,
      },
    })
  })

  it('reads an older row without migrate() as an error', async () => {
    const plain = storedKey('units', z.string().default('metric'), { storage: 'user', version: 2 })
    const { service } = await loaded({ reports: { units: row('metric', 1, 1) } })

    expect(service.bind(REPORTS, plain).getSnapshot()).toMatchObject({
      value: 'metric',
      status: 'error',
      error: { code: 'storage/invalid-value' },
    })
  })
})

describe('snapshot identity', () => {
  const filters = storedKey(
    'filters',
    z.object({ well: z.string().nullable() }).default({ well: null }),
    { storage: 'user' },
  )

  it('returns the same snapshot object until this key changes', async () => {
    const { service, handles, saves, accept } = await loaded({
      reports: { filters: row({ well: 'a' }, 1), units: row('metric', 1) },
    })
    const binding = service.bind(REPORTS, filters)
    const unitsBinding = service.bind(REPORTS, units)
    const first = binding.getSnapshot()
    const firstUnits = unitsBinding.getSnapshot()

    expect(binding.getSnapshot()).toBe(first)
    expect(first.value).toEqual({ well: 'a' })

    // Another key changes; this one does not.
    const saved = service.forCaller(REPORTS).set(units, 'imperial')
    expect(binding.getSnapshot()).toBe(first)
    accept(saves[0])
    await saved

    // The same primitive value at a newer revision keeps the snapshot.
    const current = unitsBinding.getSnapshot()
    expect(current).not.toBe(firstUnits)
    handles[0]?.replace({
      reports: { filters: row({ well: 'a' }, 1), units: row('imperial', 50) },
    })
    expect(unitsBinding.getSnapshot()).toBe(current)
    expect(binding.getSnapshot()).toBe(first)

    // A changed row is decoded once, whoever reads it.
    handles[0]?.replace({
      reports: { filters: row({ well: 'b' }, 2), units: row('imperial', 50) },
    })
    const next = binding.getSnapshot()
    expect(next).not.toBe(first)
    expect(next.value).toEqual({ well: 'b' })
    expect(binding.getSnapshot()).toBe(next)
  })
})
