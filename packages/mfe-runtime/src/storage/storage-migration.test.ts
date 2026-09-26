import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { Diagnostic, StorageEnvelope } from '@company/mfe-core'

import { DiagnosticsHub } from '../diagnostics.ts'

import { createMemoryStorageArea, type MemoryStorageArea } from '../testing/memory-storage-area.ts'
import { MfeStorageStore } from './storage-store.ts'

const ORDERS = 'acme-orders'

/** Version 2 of the filters payload; version 1 was a bare status string. */
const filtersV2 = z.object({ status: z.string(), page: z.number() })
type FiltersV2 = z.infer<typeof filtersV2>

function migrateFilters(value: unknown, fromVersion: number): FiltersV2 {
  if (fromVersion <= 1 && typeof value === 'string') return { status: value, page: 1 }
  throw new Error(`no conversion from version ${fromVersion}`)
}

interface Harness {
  readonly store: MfeStorageStore
  readonly local: MemoryStorageArea
  readonly reported: Diagnostic[]
}

let created: MfeStorageStore[] = []

function harness(): Harness {
  const local = createMemoryStorageArea()
  const reported: Diagnostic[] = []
  const diagnostics = new DiagnosticsHub()
  diagnostics.add(diagnostic => reported.push(diagnostic))
  const store = new MfeStorageStore({
    areas: { local, session: createMemoryStorageArea() },
    diagnostics,
    eventTarget: null,
  })
  created.push(store)
  return { store, local, reported }
}

function envelope(data: unknown, overrides: { readonly v?: number } = {}): string {
  return JSON.stringify({ v: overrides.v ?? 1, d: data })
}

function readEnvelope(area: MemoryStorageArea, key: string): StorageEnvelope {
  const raw = area.getItem(key)
  if (raw === null) throw new Error(`expected a record at ${key}`)
  return JSON.parse(raw) as StorageEnvelope
}

beforeEach(() => {
  created = []
})

afterEach(() => {
  for (const store of created) store.dispose()
  vi.restoreAllMocks()
})

/* -------------------------------------------------------------------------- */

describe('versioning', () => {
  it('writes version 1 by default', () => {
    const { store, local } = harness()
    store.bind(ORDERS, { name: 'filters', schema: filtersV2 }).set({ status: 'open', page: 1 })

    expect(readEnvelope(local, 'acme-orders:filters').v).toBe(1)
  })

  it('rejects a version that is not a positive integer', () => {
    const { store } = harness()

    expect(() => store.bind(ORDERS, { name: 'filters', schema: filtersV2, version: 0 })).toThrow(
      /integer schema version/,
    )
    expect(() => store.bind(ORDERS, { name: 'filters', schema: filtersV2, version: 1.5 })).toThrow(
      /integer schema version/,
    )
  })
})

describe('migration', () => {
  it('converts a known older version, validates the result, then replaces the envelope', () => {
    const { store, local } = harness()
    local.setItem('acme-orders:filters', envelope('open'))

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersV2,
      version: 2,
      migrate: migrateFilters,
    })

    expect(filters.getSnapshot()).toEqual({
      status: 'value',
      value: { status: 'open', page: 1 },
    })
    expect(readEnvelope(local, 'acme-orders:filters')).toEqual({
      v: 2,
      d: { status: 'open', page: 1 },
    })
  })

  it('converts an unversioned pre-framework record from version 0', () => {
    const { store, local } = harness()
    local.setItem('acme-orders:filters', JSON.stringify('open'))
    const migrate = vi.fn(migrateFilters)

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersV2,
      version: 2,
      migrate,
    })

    expect(migrate).toHaveBeenCalledWith('open', 0)
    expect(filters.getSnapshot()).toEqual({ status: 'value', value: { status: 'open', page: 1 } })
  })

  it('runs the conversion once per active key, not once per consumer or subscriber', () => {
    const { store, local } = harness()
    const migrate = vi.fn(migrateFilters)
    const declaration = {
      name: 'filters',
      schema: filtersV2,
      version: 2,
      migrate,
    } as const

    const mountA = store.bind(ORDERS, declaration)
    const mountB = store.bind(ORDERS, declaration)
    const listeners = Array.from({ length: 4 }, () => vi.fn())
    for (const listener of listeners) mountA.subscribe(listener)

    const older = envelope('closed')
    local.setItem('acme-orders:filters', older)
    store.handleStorageEvent({ key: 'acme-orders:filters', newValue: older, storageArea: local })

    expect(migrate).toHaveBeenCalledTimes(1)
    for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(1)
    expect(mountB.getSnapshot()).toEqual({
      status: 'value',
      value: { status: 'closed', page: 1 },
    })
  })

  it('preserves the previous record and raises when the conversion throws', () => {
    const { store, local, reported } = harness()
    const stored = envelope('open')
    local.setItem('acme-orders:filters', stored)

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersV2,
      version: 2,
      defaultValue: { status: 'all', page: 1 },
      migrate: () => {
        throw new Error('the old shape was never understood')
      },
    })

    expect(filters.getSnapshot().status).toBe('error')
    expect(() => filters.read()).toThrow(/previous record is preserved/)
    expect(local.getItem('acme-orders:filters')).toBe(stored)
    expect(reported.at(-1)?.error.code).toBe('storage/failure')
  })

  it('preserves the previous record when the conversion produces an invalid value', () => {
    const { store, local } = harness()
    const stored = envelope('open')
    local.setItem('acme-orders:filters', stored)

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersV2,
      version: 2,
      migrate: () => ({ status: 'open', page: 'one' }) as unknown as FiltersV2,
    })

    expect(filters.getSnapshot().status).toBe('error')
    expect(() => filters.read()).toThrow(/nothing was overwritten/i)
    expect(local.getItem('acme-orders:filters')).toBe(stored)
  })

  it('preserves the previous record when the replacement write fails', () => {
    const { store, local } = harness()
    const stored = envelope('open')
    local.setItem('acme-orders:filters', stored)
    vi.spyOn(local, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersV2,
      version: 2,
      migrate: migrateFilters,
    })

    expect(filters.getSnapshot().status).toBe('error')
    vi.restoreAllMocks()
    expect(local.getItem('acme-orders:filters')).toBe(stored)
  })

  it('fails visibly for a record written by a newer build', () => {
    const { store, local } = harness()
    const stored = envelope({ status: 'open', page: 1, sort: 'asc' }, { v: 5 })
    local.setItem('acme-orders:filters', stored)

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersV2,
      version: 2,
      defaultValue: { status: 'all', page: 1 },
      migrate: migrateFilters,
    })

    expect(filters.getSnapshot().status).toBe('error')
    expect(() => filters.read()).toThrow(/written by a newer build/)
    expect(local.getItem('acme-orders:filters')).toBe(stored)
  })

  it('fails visibly for an unsupported old version with no migrate declared', () => {
    const { store, local } = harness()
    const stored = envelope('open')
    local.setItem('acme-orders:filters', stored)

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersV2,
      version: 2,
      defaultValue: { status: 'all', page: 1 },
    })

    expect(() => filters.read()).toThrow(/no migrate\(\) declared/)
    expect(local.getItem('acme-orders:filters')).toBe(stored)
  })

  it('fails visibly for an unversioned record with no migrate declared', () => {
    const { store, local } = harness()
    const stored = JSON.stringify({ status: 'open', page: 1 })
    local.setItem('acme-orders:filters', stored)

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersV2,
      defaultValue: { status: 'all', page: 1 },
    })

    expect(() => filters.read()).toThrow(/unversioned record/)
    expect(local.getItem('acme-orders:filters')).toBe(stored)
  })

  it('leaves every unrelated key alone when a migration fails', () => {
    const { store, local } = harness()
    local.setItem('acme-orders:filters', envelope('open'))
    local.setItem('acme-orders:theme', envelope('dark'))
    local.setItem('shell:theme', 'shell-owned')

    const filters = store.bind(ORDERS, {
      name: 'filters',
      schema: filtersV2,
      version: 2,
      migrate: () => {
        throw new Error('nope')
      },
    })

    expect(filters.getSnapshot().status).toBe('error')
    expect(Object.keys(local.snapshot()).sort()).toEqual([
      'acme-orders:filters',
      'acme-orders:theme',
      'shell:theme',
    ])
  })
})
