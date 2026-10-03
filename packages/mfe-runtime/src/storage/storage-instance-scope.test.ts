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
    scope: 'instance',
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
      scope: 'instance',
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

  it('rejects missing, empty and host-scoped instance identities without falling back', () => {
    expect(() => bind()).toThrow(/instanceId/)
    expect(() => bind('')).toThrow(/instanceId/)
    expect(() => bind('  ')).toThrow(/instanceId/)
    expect(() =>
      store.bindHost({ name: 'zoom', schema, scope: 'instance', instanceId: 'north' }),
    ).toThrow(/instanceId/)
    expect(local.snapshot()).toEqual({})
  })

  it('definition clearing removes all its own scopes and nothing of another definition', () => {
    const north = bind('north')
    const south = bind('south')
    const other = bind('north', 'chart-legacy')
    const shared = store.bind('chart', { name: 'zoom', schema, defaultValue: 1 })
    north.set(2)
    south.set(3)
    other.set(4)
    shared.set(5)

    expect(store.clearDefinition('chart')).toBe(3)
    expect([north.read(), south.read(), shared.read(), other.read()]).toEqual([1, 1, 1, 4])
  })

  it('refuses invalid definition prefixes before an administrative clear can touch instances', () => {
    const north = bind('north')
    north.set(3)
    expect(() => store.clearDefinition('')).toThrow(/non-empty definition id/)
    expect(() => store.clearDefinition(':')).toThrow(/without a colon/)
    expect(north.read()).toBe(3)
  })

  it('separates local and session records and migrates only the chosen instance', () => {
    const key = physicalStorageKey('chart', 'zoom', 'north')
    session.setItem(key, JSON.stringify({ v: 1, d: 2 }))
    const migrated = store.bind('chart', {
      name: 'zoom',
      schema,
      defaultValue: 1,
      storage: 'session',
      scope: 'instance',
      instanceId: 'north',
      version: 2,
      migrate: value => Number(value) + 1,
    })
    expect(migrated.read()).toBe(3)
    expect(bind('north').read()).toBe(1)
    expect(session.getItem(key)).toBe(JSON.stringify({ v: 2, d: 3 }))
  })
})
