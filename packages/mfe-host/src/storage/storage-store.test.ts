import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { DiagnosticsHub, isMfeError, type ContractSchema, type Diagnostic } from '@company/mfe-core'

import { createMemoryStorageArea, type MemoryStorageArea } from './memory-storage-area.ts'
import { MfeStorageStore } from './storage-store.ts'

const ORDERS = 'acme-orders'
const REPORTS = 'acme-reports'

const filtersSchema = z.object({ status: z.string(), page: z.number() })
const themeSchema = z.enum(['light', 'dark'])

type Filters = z.infer<typeof filtersSchema>

interface Harness {
  readonly store: MfeStorageStore
  readonly local: MemoryStorageArea
  readonly session: MemoryStorageArea
  readonly diagnostics: DiagnosticsHub
  readonly reported: Diagnostic[]
}

function harness(overrides: { readonly generation?: string | null } = {}): Harness {
  const local = createMemoryStorageArea()
  const session = createMemoryStorageArea()
  const diagnostics = new DiagnosticsHub()
  const reported: Diagnostic[] = []
  diagnostics.add(diagnostic => reported.push(diagnostic))
  const generation = overrides.generation === undefined ? 'gen-1' : overrides.generation
  const store = new MfeStorageStore({
    areas: { local, session },
    diagnostics,
    ...(generation === null ? {} : { sessionGeneration: generation }),
    eventTarget: null,
  })
  return { store, local, session, diagnostics, reported }
}

function envelope(
  data: unknown,
  overrides: {
    readonly v?: number
    readonly r?: 'session' | 'preference'
    readonly g?: string | null
  } = {},
): string {
  const retention = overrides.r ?? 'session'
  const generation = overrides.g === undefined ? 'gen-1' : overrides.g
  return JSON.stringify({
    v: overrides.v ?? 1,
    r: retention,
    ...(retention === 'session' && generation !== null ? { g: generation } : {}),
    d: data,
  })
}

/** Counts validations, so the store needs no counter of its own to prove parse-once. */
function countingSchema<T>(schema: ContractSchema<T>): ContractSchema<T> & { parses: number } {
  const counted = {
    parses: 0,
    safeParse: (value: unknown) => {
      counted.parses += 1
      return schema.safeParse(value)
    },
  }
  return counted
}

let harnesses: MfeStorageStore[] = []

beforeEach(() => {
  harnesses = []
})

afterEach(() => {
  for (const store of harnesses) store.dispose()
  vi.restoreAllMocks()
})

function track(store: MfeStorageStore): MfeStorageStore {
  harnesses.push(store)
  return store
}

/* -------------------------------------------------------------------------- */

describe('key scoping', () => {
  it('writes to <id>:<key> in local storage by default and leaves session storage alone', () => {
    const { store, local, session } = harness()
    track(store)

    const filters = store.bind(ORDERS, { name: 'filters', schema: filtersSchema })
    filters.set({ status: 'open', page: 1 })

    expect(filters.key).toBe('acme-orders:filters')
    expect(filters.area).toBe('local')
    expect(Object.keys(local.snapshot())).toEqual(['acme-orders:filters'])
    expect(session.snapshot()).toEqual({})
  })

  it('shares one key between two mounts of the same definition, with no mount token in the key', () => {
    const { store } = harness()
    track(store)

    const mountA = store.bind(ORDERS, { name: 'filters', schema: filtersSchema })
    const mountB = store.bind(ORDERS, { name: 'filters', schema: filtersSchema })
    const seen = vi.fn()
    mountB.subscribe(seen)

    mountA.set({ status: 'closed', page: 3 })

    expect(mountA.key).toBe(mountB.key)
    expect(mountB.getSnapshot()).toEqual({ status: 'value', value: { status: 'closed', page: 3 } })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('keeps the same key name in two definitions and two stores independent', () => {
    const { store } = harness()
    track(store)

    const ordersLocal = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const reportsLocal = store.bind(REPORTS, { name: 'theme', schema: themeSchema })
    const ordersSession = store.bind(ORDERS, {
      name: 'theme',
      schema: themeSchema,
      area: 'session',
    })

    ordersLocal.set('dark')

    expect(ordersLocal.getSnapshot()).toEqual({ status: 'value', value: 'dark' })
    expect(reportsLocal.getSnapshot().status).toBe('default')
    expect(ordersSession.getSnapshot().status).toBe('default')
    expect(ordersSession.getSnapshot).not.toBe(ordersLocal.getSnapshot)
  })

  it('refuses a definition id containing the prefix separator', () => {
    const { store } = harness()
    track(store)

    expect(() => store.bind('acme:orders', { name: 'filters', schema: filtersSchema })).toThrow(
      /without a colon/,
    )
  })
})

describe('defaults', () => {
  it('returns the validated default for a missing key without persisting it', () => {
    const { store, local } = harness()
    track(store)

    const theme = store.bind(ORDERS, {
      name: 'theme',
      schema: themeSchema,
      defaultValue: 'light',
    })

    expect(theme.getSnapshot()).toEqual({ status: 'default', value: 'light' })
    expect(theme.read()).toBe('light')
    expect(local.snapshot()).toEqual({})
    expect(local.calls.writes).toBe(0)
  })

  it('rejects a default that does not satisfy the declared schema', () => {
    const { store, reported } = harness()
    track(store)

    expect(() =>
      store.bind(ORDERS, {
        name: 'theme',
        schema: themeSchema,
        defaultValue: 'chartreuse' as 'light',
      }),
    ).toThrow(/default matching the declared schema/)
    expect(reported).toHaveLength(1)
  })

  it('does not use the default for a malformed record, an invalid one, or an unreadable store', () => {
    const { store, local } = harness()
    track(store)
    local.setItem('acme-orders:filters', '{not json')
    local.setItem('acme-orders:theme', envelope('chartreuse'))

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersSchema,
      defaultValue: { status: 'open', page: 1 },
    })
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })

    expect(filters.getSnapshot().status).toBe('error')
    expect(theme.getSnapshot().status).toBe('error')
    expect(() => filters.read()).toThrow(/not JSON/)
    expect(() => theme.read()).toThrow(/declared schema/)
  })

  it('reports a missing key as null when no default is declared', () => {
    const { store } = harness()
    track(store)

    const filters = store.bind(ORDERS, { name: 'filters', schema: filtersSchema })
    expect(filters.getSnapshot()).toEqual({ status: 'default', value: null })
    expect(filters.read()).toBeNull()
  })
})

describe('validation and failure', () => {
  it('leaves the stored value unchanged and throws when a write fails validation', () => {
    const { store, local, reported } = harness()
    track(store)

    const filters = store.bind(ORDERS, { name: 'filters', schema: filtersSchema })
    filters.set({ status: 'open', page: 1 })
    const before = local.getItem('acme-orders:filters')
    const listener = vi.fn()
    filters.subscribe(listener)

    expect(() => filters.set({ status: 'open', page: 'two' } as unknown as Filters)).toThrow(
      /declared schema/,
    )

    expect(local.getItem('acme-orders:filters')).toBe(before)
    expect(filters.getSnapshot()).toEqual({ status: 'value', value: { status: 'open', page: 1 } })
    expect(listener).not.toHaveBeenCalled()
    expect(reported.at(-1)?.error.code).toBe('storage/failure')
  })

  it('surfaces a quota failure as a structured error and keeps the previous value', () => {
    const { store, local } = harness()
    track(store)
    const filters = store.bind(ORDERS, { name: 'filters', schema: filtersSchema })
    filters.set({ status: 'open', page: 1 })
    const before = local.getItem('acme-orders:filters')

    vi.spyOn(local, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    let thrown: unknown
    try {
      filters.set({ status: 'open', page: 2 })
    } catch (error) {
      thrown = error
    }

    expect(isMfeError(thrown)).toBe(true)
    expect((thrown as { code: string }).code).toBe('storage/failure')
    expect(String(thrown)).toMatch(/stored value is unchanged/)
    vi.restoreAllMocks()
    expect(local.getItem('acme-orders:filters')).toBe(before)
  })

  it('never falls back to another store or to memory when the area throws on access', () => {
    const local = createMemoryStorageArea()
    const session = createMemoryStorageArea()
    const store = track(
      new MfeStorageStore({
        areas: {
          local: () => {
            throw new Error('SecurityError: access to storage is denied')
          },
          session,
        },
        sessionGeneration: 'gen-1',
        eventTarget: null,
      }),
    )

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersSchema,
      defaultValue: { status: 'open', page: 1 },
    })

    const snapshot = filters.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(() => filters.read()).toThrow(/never falls back/)
    expect(() => filters.set({ status: 'open', page: 2 })).toThrow(/storage to be available/)
    expect(session.snapshot()).toEqual({})
    expect(local.snapshot()).toEqual({})
  })

  it('works when the browser global itself throws on property access', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('access denied', 'SecurityError')
      },
    })
    try {
      const store = track(new MfeStorageStore({ sessionGeneration: 'gen-1', eventTarget: null }))
      const theme = store.bind(ORDERS, {
        name: 'theme',
        schema: themeSchema,
        defaultValue: 'light',
      })
      expect(theme.getSnapshot().status).toBe('error')
      expect(() => theme.set('dark')).toThrow(/storage to be available/)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('publishes an error snapshot when an external change turns the value invalid', () => {
    const { store, local } = harness()
    track(store)
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })
    theme.set('dark')
    const listener = vi.fn()
    theme.subscribe(listener)

    local.setItem('acme-orders:theme', envelope('chartreuse'))
    store.handleStorageEvent({
      key: 'acme-orders:theme',
      newValue: envelope('chartreuse'),
      storageArea: local,
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(theme.getSnapshot().status).toBe('error')
    expect(() => theme.read()).toThrow(/declared schema/)
  })

  it('reports a read failure to diagnostics as well as to the reader', () => {
    const { store, local, reported } = harness()
    track(store)
    local.setItem('acme-orders:theme', 'not-json')

    store.bind(ORDERS, { name: 'theme', schema: themeSchema })

    expect(reported).toHaveLength(1)
    expect(reported[0]?.error.code).toBe('storage/failure')
    expect(reported[0]?.error.id).toBe(ORDERS)
  })
})

describe('setters', () => {
  it('resolves a functional update against the latest valid stored value', () => {
    const { store, local } = harness()
    track(store)
    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersSchema,
      defaultValue: { status: 'open', page: 1 },
    })

    // Another document wrote without this one hearing about it.
    local.setItem('acme-orders:filters', envelope({ status: 'closed', page: 7 }))

    filters.set(current => ({ ...current, page: current.page + 1 }))

    expect(filters.getSnapshot()).toEqual({
      status: 'value',
      value: { status: 'closed', page: 8 },
    })
  })

  it('applies a functional update to the declared default when the key is missing', () => {
    const { store } = harness()
    track(store)
    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersSchema,
      defaultValue: { status: 'open', page: 1 },
    })

    filters.set(current => ({ ...current, page: current.page + 1 }))

    expect(filters.getSnapshot()).toEqual({ status: 'value', value: { status: 'open', page: 2 } })
  })

  it('refuses a functional update while the stored record is unreadable', () => {
    const { store, local } = harness()
    track(store)
    local.setItem('acme-orders:theme', '{oops')
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })

    expect(() => theme.set(current => current)).toThrow(/no valid base/)
    expect(theme.set.bind(null, 'dark')).not.toThrow()
    expect(theme.getSnapshot()).toEqual({ status: 'value', value: 'dark' })
  })

  it('publishes the committed value to every same-document subscriber of that key', () => {
    const { store } = harness()
    track(store)
    const a = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const b = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const seenA = vi.fn()
    const seenB = vi.fn()
    a.subscribe(seenA)
    b.subscribe(seenB)

    a.set('dark')

    expect(seenA).toHaveBeenCalledTimes(1)
    expect(seenB).toHaveBeenCalledTimes(1)
    expect(b.getSnapshot()).toEqual({ status: 'value', value: 'dark' })
  })
})

describe('subscriptions', () => {
  it('scopes a subscription to the exact id, store and key', () => {
    const { store } = harness()
    track(store)
    const watched = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const otherKey = store.bind(ORDERS, { name: 'filters', schema: filtersSchema })
    const otherDefinition = store.bind(REPORTS, { name: 'theme', schema: themeSchema })
    const otherStore = store.bind(ORDERS, {
      name: 'theme',
      schema: themeSchema,
      area: 'session',
    })
    const listener = vi.fn()
    watched.subscribe(listener)

    otherKey.set({ status: 'open', page: 1 })
    otherDefinition.set('dark')
    otherStore.set('dark')

    expect(listener).not.toHaveBeenCalled()
  })

  it('treats an unchanged serialized value as a no-op for notifications', () => {
    const { store } = harness()
    track(store)
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    theme.set('dark')
    const before = theme.getSnapshot()
    const listener = vi.fn()
    theme.subscribe(listener)

    theme.set('dark')
    store.handleStorageEvent({
      key: 'acme-orders:theme',
      newValue: envelope('dark'),
      storageArea: undefined,
    })

    expect(listener).not.toHaveBeenCalled()
    expect(theme.getSnapshot()).toBe(before)
  })

  it('keeps snapshot, subscribe and setter identity stable while the binding is unchanged', () => {
    const { store } = harness()
    track(store)
    const first = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })
    const second = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })

    expect(first.getSnapshot()).toBe(first.getSnapshot())
    expect(first.getSnapshot).toBe(second.getSnapshot)
    expect(first.subscribe).toBe(second.subscribe)
    expect(first.set).toBe(second.set)

    const before = first.getSnapshot()
    first.set('dark')
    const after = first.getSnapshot()
    expect(after).not.toBe(before)
    expect(first.getSnapshot()).toBe(after)
    expect(first.set).toBe(second.set)
  })

  it('stops notifying after unsubscribe, and unsubscribing twice is harmless', () => {
    const { store } = harness()
    track(store)
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const listener = vi.fn()
    const unsubscribe = theme.subscribe(listener)

    theme.set('dark')
    unsubscribe()
    unsubscribe()
    theme.set('light')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('notifies subscribers when the key is removed, with the declared default', () => {
    const { store } = harness()
    track(store)
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })
    theme.set('dark')
    const listener = vi.fn()
    theme.subscribe(listener)

    theme.remove()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(theme.getSnapshot()).toEqual({ status: 'default', value: 'light' })
  })
})

describe('cross-tab storage events', () => {
  it('applies a value another tab wrote to the same key', () => {
    const { store, local } = harness()
    track(store)
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })
    const listener = vi.fn()
    theme.subscribe(listener)

    store.handleStorageEvent({
      key: 'acme-orders:theme',
      newValue: envelope('dark'),
      storageArea: local,
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(theme.getSnapshot()).toEqual({ status: 'value', value: 'dark' })
  })

  it('ignores an event for a key nobody is bound to, without reading storage', () => {
    const { store, local } = harness()
    track(store)
    store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const getItem = vi.spyOn(local, 'getItem')

    store.handleStorageEvent({
      key: 'some-other-app:preference',
      newValue: envelope('dark'),
      storageArea: local,
    })

    expect(getItem).not.toHaveBeenCalled()
  })

  it('ignores an event from a store the framework does not own', () => {
    const { store } = harness()
    track(store)
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const listener = vi.fn()
    theme.subscribe(listener)

    store.handleStorageEvent({
      key: 'acme-orders:theme',
      newValue: envelope('dark'),
      storageArea: createMemoryStorageArea(),
    })

    expect(listener).not.toHaveBeenCalled()
    expect(theme.getSnapshot().status).toBe('default')
  })

  it('checks only the active keys of the cleared store when key is null', () => {
    const { store, local, session } = harness()
    track(store)
    local.setItem('acme-orders:theme', envelope('dark'))
    local.setItem('unrelated-app:cache', 'anything')
    const localTheme = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const localFilters = store.bind(ORDERS, { name: 'filters', schema: filtersSchema })
    const sessionTheme = store.bind(REPORTS, {
      name: 'theme',
      schema: themeSchema,
      area: 'session',
    })
    const localGetItem = vi.spyOn(local, 'getItem')
    const sessionGetItem = vi.spyOn(session, 'getItem')

    local.reset()
    store.handleStorageEvent({ key: null, newValue: null, storageArea: local })

    expect(localGetItem.mock.calls.map(call => call[0]).sort()).toEqual([
      'acme-orders:filters',
      'acme-orders:theme',
    ])
    expect(sessionGetItem).not.toHaveBeenCalled()
    expect(localTheme.getSnapshot().status).toBe('default')
    expect(localFilters.getSnapshot().status).toBe('default')
    expect(sessionTheme.getSnapshot().status).toBe('default')
  })

  it('observes session-storage events for keys bound to the session store', () => {
    const { store, session } = harness()
    track(store)
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema, area: 'session' })
    const listener = vi.fn()
    theme.subscribe(listener)

    store.handleStorageEvent({
      key: 'acme-orders:theme',
      newValue: envelope('dark'),
      storageArea: session,
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(theme.getSnapshot()).toEqual({ status: 'value', value: 'dark' })
  })

  it('reaches subscribers through a native window storage event', () => {
    const local = createMemoryStorageArea()
    const store = track(new MfeStorageStore({ areas: { local }, sessionGeneration: 'gen-1' }))
    const theme = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const listener = vi.fn()
    theme.subscribe(listener)

    local.setItem('acme-orders:theme', envelope('dark'))
    globalThis.dispatchEvent(
      new StorageEvent('storage', { key: 'acme-orders:theme', newValue: envelope('dark') }),
    )

    expect(listener).toHaveBeenCalledTimes(1)
    expect(theme.getSnapshot()).toEqual({ status: 'value', value: 'dark' })
  })
})

describe('imperative storage', () => {
  it('notifies reactive subscribers of an imperative write and removal', () => {
    const { store } = harness()
    track(store)
    const bound = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })
    const listener = vi.fn()
    bound.subscribe(listener)

    const storage = store.storageFor(ORDERS)
    const key = storage.key('theme', themeSchema)
    key.set('dark')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(bound.getSnapshot()).toEqual({ status: 'value', value: 'dark' })

    storage.remove('theme')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(bound.getSnapshot()).toEqual({ status: 'default', value: 'light' })
  })

  it('returns null for a missing key and throws for an invalid one', () => {
    const { store, local } = harness()
    track(store)
    const storage = store.storageFor(ORDERS)
    const theme = storage.key('theme', themeSchema)

    expect(theme.get()).toBeNull()

    local.setItem('acme-orders:theme', envelope('chartreuse'))
    expect(() => theme.get()).toThrow(/declared schema/)
  })

  it('clears only the exact prefix and notifies every mount of that definition', () => {
    const { store, local } = harness()
    track(store)
    local.setItem('acme-orders:theme', envelope('dark'))
    local.setItem('acme-orders:filters', envelope({ status: 'open', page: 1 }))
    local.setItem('acme-orders-legacy:theme', envelope('dark'))
    local.setItem('shell:theme', 'shell-owned')
    local.setItem('third-party-widget', 'not ours')

    const mountA = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })
    const mountB = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })
    const seenA = vi.fn()
    const seenB = vi.fn()
    mountA.subscribe(seenA)
    mountB.subscribe(seenB)

    store.storageFor(ORDERS).clear()

    expect(Object.keys(local.snapshot()).sort()).toEqual([
      'acme-orders-legacy:theme',
      'shell:theme',
      'third-party-widget',
    ])
    expect(seenA).toHaveBeenCalledTimes(1)
    expect(seenB).toHaveBeenCalledTimes(1)
    expect(mountA.getSnapshot()).toEqual({ status: 'default', value: 'light' })
  })

  it('clears each store separately', () => {
    const { store, local, session } = harness()
    track(store)
    local.setItem('acme-orders:theme', envelope('dark'))
    session.setItem('acme-orders:theme', envelope('dark'))

    store.storageFor(ORDERS, 'session').clear()

    expect(Object.keys(local.snapshot())).toEqual(['acme-orders:theme'])
    expect(session.snapshot()).toEqual({})
  })
})

describe('declaration conflicts', () => {
  it('fails the conflicting declaration rather than the one that rendered first', () => {
    const { store } = harness()
    track(store)
    const first = store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })
    first.set('dark')

    expect(() => store.bind(ORDERS, { name: 'theme', schema: z.string() })).toThrow(
      /same schema object/,
    )
    expect(first.getSnapshot()).toEqual({ status: 'value', value: 'dark' })
  })

  it('rejects disagreement over the default, the retention and the version', () => {
    const { store } = harness()
    track(store)
    store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'light' })

    expect(() =>
      store.bind(ORDERS, { name: 'theme', schema: themeSchema, defaultValue: 'dark' }),
    ).toThrow(/defaultValue/)
    expect(() =>
      store.bind(ORDERS, {
        name: 'theme',
        schema: themeSchema,
        defaultValue: 'light',
        retention: 'preference',
      }),
    ).toThrow(/retention/)
    expect(() =>
      store.bind(ORDERS, {
        name: 'theme',
        schema: themeSchema,
        defaultValue: 'light',
        version: 2,
      }),
    ).toThrow(/version/)
  })

  it('rejects an imperative declaration that disagrees with the active one', () => {
    const { store } = harness()
    track(store)
    store.bind(ORDERS, { name: 'theme', schema: themeSchema })

    const storage = store.storageFor(ORDERS)
    expect(() => storage.key('theme', z.string()).get()).toThrow(/same schema object/)
  })

  it('accepts an imperative declaration that declares no default beside a bound one that does', () => {
    const { store } = harness()
    track(store)
    const bound = store.bind(ORDERS, {
      name: 'theme',
      schema: themeSchema,
      defaultValue: 'light',
    })

    const key = store.storageFor(ORDERS).key('theme', themeSchema)
    expect(key.get()).toBeNull()

    key.set('dark')
    expect(bound.getSnapshot()).toEqual({ status: 'value', value: 'dark' })
    expect(key.get()).toBe('dark')
  })
})

describe('performance gates', () => {
  it('does not read or parse browser storage on repeated getSnapshot calls', () => {
    const { store, local } = harness()
    track(store)
    local.setItem('acme-orders:filters', envelope({ status: 'open', page: 1 }))
    const getItem = vi.spyOn(local, 'getItem')

    const counted = countingSchema(filtersSchema)

    const filters = store.bind(ORDERS, { name: 'filters', schema: counted })
    const readsAfterBind = local.calls.reads
    expect(getItem).toHaveBeenCalledTimes(1)
    expect(counted.parses).toBe(1)

    for (let index = 0; index < 100; index += 1) filters.getSnapshot()

    expect(getItem).toHaveBeenCalledTimes(1)
    expect(counted.parses).toBe(1)
    expect(local.calls.reads).toBe(readsAfterBind)
    expect(filters.getSnapshot()).toBe(filters.getSnapshot())
  })

  it('parses a changed representation once per key, not once per subscriber', () => {
    const { store, local } = harness()
    track(store)
    const counted = countingSchema(filtersSchema)
    const filters = store.bind(ORDERS, { name: 'filters', schema: counted })
    const listeners = Array.from({ length: 5 }, () => vi.fn())
    for (const listener of listeners) filters.subscribe(listener)
    const parsesBefore = counted.parses

    store.handleStorageEvent({
      key: 'acme-orders:filters',
      newValue: envelope({ status: 'closed', page: 4 }),
      storageArea: local,
    })

    expect(counted.parses).toBe(parsesBefore + 1)
    for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the key alive while any consumer holds it, and tears it down on the last release', () => {
    const { store, local } = harness()
    track(store)
    const a = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const b = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    const unsubscribe = a.subscribe(vi.fn())
    const readsAfterBind = local.calls.reads

    // Two consumers, one key: the second binding read nothing of its own.
    expect(b.getSnapshot()).toBe(a.getSnapshot())

    unsubscribe()
    a.release()
    a.release() // Idempotent: a double release must not drop b's hold.
    const c = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    expect(c.getSnapshot()).toBe(b.getSnapshot())
    expect(local.calls.reads).toBe(readsAfterBind)

    b.release()
    c.release()
    c.release()
    // The last release tore the key down, so the next bind reads the store again.
    store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    expect(local.calls.reads).toBeGreaterThan(readsAfterBind)
  })

  it('re-reads once after a key binding is torn down and re-created', () => {
    const { store, local } = harness()
    track(store)
    const first = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    first.release()
    const getItem = vi.spyOn(local, 'getItem')

    const second = store.bind(ORDERS, { name: 'theme', schema: themeSchema })
    second.getSnapshot()
    second.getSnapshot()

    expect(getItem).toHaveBeenCalledTimes(1)
    expect(second.getSnapshot).not.toBe(first.getSnapshot)
  })
})
