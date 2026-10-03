import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { physicalStorageKey } from '@company/mfe-core'
import { createMemoryStorageArea } from '../testing/memory-storage-area.ts'
import { MfeStorageStore } from './storage-store.ts'

const schema = z.number()
const local = createMemoryStorageArea()
const session = createMemoryStorageArea()
let store = new MfeStorageStore({ areas: { local, session }, eventTarget: null })

afterEach(() => {
  store.dispose()
  local.reset()
  session.reset()
  store = new MfeStorageStore({ areas: { local, session }, eventTarget: null })
})

function bind(instanceId?: string, definitionId = 'chart') {
  return store.bind(definitionId, {
    name: 'zoom',
    schema,
    defaultValue: 1,
    ...(instanceId === undefined ? {} : { instanceId }),
  })
}

describe('instance-scoped storage', () => {
  it('isolates instance, definition and key names, including ambiguous separator characters', () => {
    const first = bind('north:zoom')
    const second = store.bind('chart', {
      name: 'zoom:zoom',
      schema,
      defaultValue: 1,
      instanceId: 'north',
    })
    const otherDefinition = bind('north:zoom', 'chart-legacy')
    const shared = store.bind('chart', { name: 'zoom', schema, defaultValue: 1 })
    first.set(7)

    expect(first.read()).toBe(7)
    expect(second.read()).toBe(1)
    expect(otherDefinition.read()).toBe(1)
    expect(shared.read()).toBe(1)
    expect(first.key).not.toBe(second.key)
    expect(first.key).toBe(physicalStorageKey('chart', 'zoom', 'north:zoom'))
  })

  it('keeps persisted state after releasing the last binding and creating a fresh runtime', () => {
    const first = bind('north')
    first.set(3)
    first.release()
    store.dispose()
    store = new MfeStorageStore({ areas: { local, session }, eventTarget: null })

    expect(bind('north').read()).toBe(3)
    expect(bind('south').read()).toBe(1)
  })

  it('rejects empty and host-scoped instance identities without falling back', () => {
    expect(() => bind('')).toThrow(/instanceId/)
    expect(() => bind('  ')).toThrow(/instanceId/)
    expect(() => store.bindHost({ name: 'zoom', schema, instanceId: 'north' })).toThrow(
      /instanceId/,
    )
    expect(local.snapshot()).toEqual({})
  })

  it('separates local and session records and migrates only the chosen instance', () => {
    const key = physicalStorageKey('chart', 'zoom', 'north')
    session.setItem(key, JSON.stringify({ v: 1, d: 2 }))
    const migrated = store.bind('chart', {
      name: 'zoom',
      schema,
      defaultValue: 1,
      storage: 'session',
      instanceId: 'north',
      version: 2,
      migrate: value => Number(value) + 1,
    })
    expect(migrated.read()).toBe(3)
    expect(bind('north').read()).toBe(1)
    expect(session.getItem(key)).toBe(JSON.stringify({ v: 2, d: 3 }))
  })
})
