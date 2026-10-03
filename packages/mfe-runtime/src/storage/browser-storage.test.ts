/**
 * The `local` and `session` areas through the one storage API: the same snapshot, status and
 * awaitable writes as the `user` area, over the browser store.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { HOST_SCOPE, physicalStorageKey, storedKey } from '@company/mfe-core'

import { createMemoryStorageArea, type MemoryStorageArea } from '../testing/memory-storage-area.ts'
import { StorageService, type StorageCaller } from './service.ts'
import { MfeStorageStore } from './storage-store.ts'

const sidebarOpen = storedKey('sidebar-open', z.boolean().default(true))
const counter = storedKey('counter', z.number().int().default(0), { storage: 'session' })

const REPORTS: StorageCaller = { owner: 'reports' }

const envelope = (d: unknown, v = 1): string => JSON.stringify({ v, d })

const services: StorageService[] = []

afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
})

/** A store that refuses writes while `full` is set, as a browser over its quota does. */
function quotaArea(): MemoryStorageArea & { full: boolean } {
  const area = createMemoryStorageArea()
  const quota = Object.assign(area, { full: false })
  const setItem = area.setItem.bind(area)
  quota.setItem = (key, value) => {
    if (quota.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    setItem(key, value)
  }
  return quota
}

function setup() {
  const local = quotaArea()
  const session = createMemoryStorageArea()
  const service = new StorageService({
    browser: new MfeStorageStore({ areas: { local, session }, eventTarget: null }),
  })
  services.push(service)
  return { service, local, session, storage: service.forCaller(REPORTS) }
}

describe('reading', () => {
  it('is ready at once, with the default until something is stored', () => {
    const { service, local } = setup()
    const binding = service.bind(REPORTS, sidebarOpen)

    expect(binding.getSnapshot()).toEqual({ value: true, status: 'ready', error: undefined })
    binding.release()

    local.setItem(physicalStorageKey('reports', 'sidebar-open'), envelope(false))
    expect(service.bind(REPORTS, sidebarOpen).getSnapshot()).toEqual({
      value: false,
      status: 'ready',
      error: undefined,
    })
  })

  it('reads an invalid stored value as the default with an invalid-value error', async () => {
    const { service, storage, local } = setup()
    local.setItem(physicalStorageKey('reports', 'sidebar-open'), envelope('yes'))
    const binding = service.bind(REPORTS, sidebarOpen)

    expect(binding.getSnapshot()).toMatchObject({
      value: true,
      status: 'error',
      error: { code: 'storage/invalid-value' },
    })
    expect(binding.getSnapshot()).toBe(binding.getSnapshot())
    expect(await storage.get(sidebarOpen)).toBe(true)
    await expect(storage.set(sidebarOpen, previous => !previous)).rejects.toMatchObject({
      code: 'storage/invalid-value',
    })

    await storage.set(sidebarOpen, false)
    expect(binding.getSnapshot()).toEqual({ value: false, status: 'ready', error: undefined })
  })

  it('keeps local and session values apart', async () => {
    const { storage, local, session } = setup()

    await storage.set(counter, 2)

    expect(storage.peek(counter)).toBe(2)
    expect(Object.keys(session.snapshot())).toEqual([physicalStorageKey('reports', 'counter')])
    expect(local.snapshot()).toEqual({})
  })
})

describe('writing', () => {
  it('resolves once written and notifies subscribers only when the value changes', async () => {
    const { storage, local } = setup()
    const listener = vi.fn()
    const stop = storage.subscribe(sidebarOpen, listener)

    await storage.set(sidebarOpen, false)
    await storage.set(sidebarOpen, false)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(false)
    expect(local.getItem(physicalStorageKey('reports', 'sidebar-open'))).toBe(envelope(false))
    stop()
    stop()
  })

  it('applies a functional update to the current value', async () => {
    const { storage } = setup()

    await storage.set(counter, previous => previous + 1)
    await storage.set(counter, previous => previous + 1)

    expect(storage.peek(counter)).toBe(2)
  })

  it('removes the stored value on reset, so the default reads again', async () => {
    const { storage, local } = setup()
    await storage.set(sidebarOpen, false)

    await storage.reset(sidebarOpen)

    expect(storage.peek(sidebarOpen)).toBe(true)
    expect(storage.status(sidebarOpen)).toBe('ready')
    expect(local.snapshot()).toEqual({})
  })

  it('rejects a write the browser refuses, and stays in error until a write succeeds', async () => {
    const { service, storage, local } = setup()
    const binding = service.bind(REPORTS, sidebarOpen)
    const listener = vi.fn()
    binding.subscribe(listener)
    local.full = true

    await expect(storage.set(sidebarOpen, false)).rejects.toMatchObject({
      code: 'storage/persistence-failed',
    })
    expect(binding.getSnapshot()).toMatchObject({
      value: true,
      status: 'error',
      error: { code: 'storage/persistence-failed' },
    })
    expect(listener).toHaveBeenCalledTimes(1)

    local.full = false
    await storage.set(sidebarOpen, false)
    expect(binding.getSnapshot()).toEqual({ value: false, status: 'ready', error: undefined })
  })

  it('clears a refused write’s error on retry', async () => {
    const { service, storage, local } = setup()
    const binding = service.bind(REPORTS, sidebarOpen)
    local.full = true
    await expect(storage.set(sidebarOpen, false)).rejects.toBeDefined()

    await binding.retry()

    expect(binding.getSnapshot().status).toBe('ready')
  })

  it('rejects a value that fails the schema without touching the status or the store', async () => {
    const { service, storage, local } = setup()
    await storage.set(sidebarOpen, false)
    const before = service.bind(REPORTS, sidebarOpen).getSnapshot()

    await expect(storage.set(sidebarOpen, 'no' as unknown as boolean)).rejects.toMatchObject({
      code: 'storage/invalid-value',
    })

    expect(service.bind(REPORTS, sidebarOpen).getSnapshot()).toEqual(before)
    expect(local.getItem(physicalStorageKey('reports', 'sidebar-open'))).toBe(envelope(false))
  })

  it('rejects a write after the caller went away, without changing the status', async () => {
    const { service, local } = setup()
    const controller = new AbortController()
    const storage = service.forCaller({ owner: 'reports', signal: controller.signal })
    controller.abort()

    await expect(storage.set(sidebarOpen, false)).rejects.toMatchObject({
      code: 'storage/disposed',
    })
    await expect(storage.reset(sidebarOpen)).rejects.toMatchObject({ code: 'storage/disposed' })
    expect(storage.status(sidebarOpen)).toBe('ready')
    expect(local.snapshot()).toEqual({})
  })
})

describe('owners', () => {
  it('refuses storedKey.from outside the user area', () => {
    const { service } = setup()
    const labSidebar = storedKey.from('lab', 'sidebar-open', z.boolean().default(true))

    expect(() => service.bind(REPORTS, labSidebar)).toThrow(
      expect.objectContaining({ code: 'storage/unauthorized-owner' }),
    )
  })

  it('refuses something that is not a declared key', () => {
    const { service } = setup()

    expect(() =>
      service.bind(REPORTS, { name: 'sidebar-open' } as unknown as typeof sidebarOpen),
    ).toThrow(expect.objectContaining({ code: 'storage/invalid-value' }))
  })

  it('stores the host page’s values under the host scope', async () => {
    const { service, local } = setup()

    await service.forCaller({ owner: HOST_SCOPE }).set(sidebarOpen, false)

    expect(Object.keys(local.snapshot())).toEqual([physicalStorageKey(HOST_SCOPE, 'sidebar-open')])
    expect(service.forCaller(REPORTS).peek(sidebarOpen)).toBe(true)
  })

  it('keeps a perInstance value per instanceId', async () => {
    const { service } = setup()
    const zoom = storedKey('zoom', z.number().default(1), { perInstance: true })
    const north = service.forCaller({ owner: 'chart', instanceId: 'north' })

    await north.set(zoom, 3)

    expect(north.peek(zoom)).toBe(3)
    expect(service.forCaller({ owner: 'chart', instanceId: 'south' }).peek(zoom)).toBe(1)
    expect(() => service.forCaller({ owner: 'chart' }).peek(zoom)).toThrow(/instanceId/)
  })
})
