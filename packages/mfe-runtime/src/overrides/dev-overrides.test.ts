/**
 * Every assertion here is about a failure being *reported* rather than swallowed, because
 * an override that silently did nothing is the phantom bug the visible-override requirement
 * exists to prevent.
 */

import { describe, expect, it } from 'vitest'

import { createMemoryStorageArea } from '../testing/memory-storage-area.ts'
import {
  discardDevOverrides,
  findConflictingContainerOverrides,
  findUnregisteredOverrides,
  OVERRIDES_STORAGE_KEY,
  readDevOverrides,
  writeDevOverrides,
} from './dev-overrides.ts'

/** A storage that refuses this origin, which is what a blocked browser does. */
function blockedStorage(): Storage {
  const refuse = (): never => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  }
  return {
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
  } as unknown as Storage
}

describe('reading developer overrides', () => {
  it('reads an absolute manifest URL per definition id', () => {
    const storage = createMemoryStorageArea({
      [OVERRIDES_STORAGE_KEY]: '{"operations":"http://localhost:3001/mf-manifest.json"}',
    })

    const { overrides, diagnostics } = readDevOverrides(storage)

    expect([...overrides]).toEqual([['operations', 'http://localhost:3001/mf-manifest.json']])
    expect(diagnostics).toHaveLength(0)
  })

  it('reports nothing when no override was ever set', () => {
    const { overrides, diagnostics } = readDevOverrides(createMemoryStorageArea())

    expect(overrides.size).toBe(0)
    expect(diagnostics).toHaveLength(0)
  })

  it('diagnoses a blocked store rather than throwing out of boot', () => {
    const { overrides, diagnostics } = readDevOverrides(blockedStorage())

    expect(overrides.size).toBe(0)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain('Browser storage is blocked')
  })

  it('diagnoses text that is not JSON, naming the repair', () => {
    const storage = createMemoryStorageArea({ [OVERRIDES_STORAGE_KEY]: 'operations=3001' })

    const { overrides, diagnostics } = readDevOverrides(storage)

    expect(overrides.size).toBe(0)
    expect(diagnostics[0]?.message).toContain(OVERRIDES_STORAGE_KEY)
  })

  it('diagnoses a relative URL, because it would resolve against the shell', () => {
    const storage = createMemoryStorageArea({
      [OVERRIDES_STORAGE_KEY]: '{"operations":"/mf-manifest.json"}',
    })

    const { overrides, diagnostics } = readDevOverrides(storage)

    expect(overrides.size).toBe(0)
    expect(diagnostics).toHaveLength(1)
  })

  it('keeps the entries it understood beside the one it rejected', () => {
    const storage = createMemoryStorageArea({
      [OVERRIDES_STORAGE_KEY]: '{"operations":"http://localhost:3001/m.json","reports":7}',
    })

    const { overrides, diagnostics } = readDevOverrides(storage)

    expect([...overrides.keys()]).toEqual(['operations'])
    expect(diagnostics).toHaveLength(1)
  })
})

describe('where an override may point', () => {
  it('accepts every loopback host, on any port and either scheme', () => {
    const storage = createMemoryStorageArea({
      [OVERRIDES_STORAGE_KEY]: JSON.stringify({
        a: 'http://localhost:3001/mf-manifest.json',
        b: 'https://127.0.0.1:8443/mf-manifest.json',
        c: 'http://[::1]:3002/mf-manifest.json',
      }),
    })

    const { overrides, diagnostics } = readDevOverrides(storage)

    expect([...overrides.keys()]).toEqual(['a', 'b', 'c'])
    expect(diagnostics).toHaveLength(0)
  })

  /** The key is read in deployed builds, so anything that can write it could load its own code. */
  it('rejects any other origin, saying how to allow it', () => {
    const storage = createMemoryStorageArea({
      [OVERRIDES_STORAGE_KEY]: '{"operations":"https://cdn.attacker.test/mf-manifest.json"}',
    })

    const { overrides, diagnostics } = readDevOverrides(storage)

    expect(overrides.size).toBe(0)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain('https://cdn.attacker.test')
    expect(diagnostics[0]?.message).toContain('overrideOrigins')
  })

  it('accepts an origin the host allows, matched exactly', () => {
    const storage = createMemoryStorageArea({
      [OVERRIDES_STORAGE_KEY]: JSON.stringify({
        operations: 'https://preview.example.test/operations/mf-manifest.json',
        reports: 'https://preview.example.test:8443/reports/mf-manifest.json',
      }),
    })

    const { overrides, diagnostics } = readDevOverrides(storage, {
      allowedOrigins: ['https://preview.example.test'],
    })

    expect([...overrides.keys()]).toEqual(['operations'])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.id).toBe('reports')
  })
})

describe("discarding another user's overrides", () => {
  it('removes them and says so', () => {
    const storage = createMemoryStorageArea({
      [OVERRIDES_STORAGE_KEY]: '{"operations":"http://localhost:3001/mf-manifest.json"}',
    })

    const { overrides, diagnostics } = discardDevOverrides(storage)

    expect(overrides.size).toBe(0)
    expect(storage.getItem(OVERRIDES_STORAGE_KEY)).toBeNull()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain('have been removed')
  })

  it('applies none from a storage it cannot remove them from, and names the repair', () => {
    const storage = {
      getItem: () => '{"operations":"http://localhost:3001/mf-manifest.json"}',
    }

    const { overrides, diagnostics } = discardDevOverrides(storage)

    expect(overrides.size).toBe(0)
    expect(diagnostics[0]?.message).toContain(`localStorage.removeItem('${OVERRIDES_STORAGE_KEY}')`)
  })

  it('says nothing when there were none', () => {
    const storage = createMemoryStorageArea()

    const { diagnostics } = discardDevOverrides(storage)

    expect(diagnostics).toHaveLength(0)
    expect(storage.calls.removes).toBe(0)
  })
})

describe('overrides for ids the registry does not list', () => {
  it('reports each one, since it changes nothing', () => {
    const diagnostics = findUnregisteredOverrides(
      new Map([
        ['operations', 'http://localhost:3001/mf-manifest.json'],
        ['opertions', 'http://localhost:3002/mf-manifest.json'],
      ]),
      new Set(['operations']),
    )

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.id).toBe('opertions')
    expect(diagnostics[0]?.message).toContain('registry.json')
  })
})

describe('writing developer overrides', () => {
  it('round-trips through the reader', () => {
    const storage = createMemoryStorageArea()

    const wrote = writeDevOverrides(
      storage,
      new Map([['operations', 'http://localhost:3001/mf-manifest.json']]),
    )

    expect(wrote).toBe(true)
    expect([...readDevOverrides(storage).overrides]).toEqual([
      ['operations', 'http://localhost:3001/mf-manifest.json'],
    ])
  })

  it('removes the key for an empty map, so cleared reads like never set', () => {
    const storage = createMemoryStorageArea({
      [OVERRIDES_STORAGE_KEY]: '{"operations":"http://x/"}',
    })

    expect(writeDevOverrides(storage, new Map())).toBe(true)

    expect(storage.getItem(OVERRIDES_STORAGE_KEY)).toBeNull()
    expect(storage.calls.removes).toBe(1)
    expect(storage.calls.writes).toBe(0)
  })

  it('reports a blocked store instead of claiming it worked', () => {
    expect(writeDevOverrides(blockedStorage(), new Map([['a', 'http://x/']]))).toBe(false)
  })
})

describe('conflicting container overrides', () => {
  it('reports one container whose definitions were pointed at different URLs', () => {
    const conflicts = findConflictingContainerOverrides(
      new Map([
        ['wells', 'http://localhost:3001/mf-manifest.json'],
        ['reports', 'http://localhost:3009/mf-manifest.json'],
      ]),
      new Map([
        ['wells', 'operations'],
        ['reports', 'operations'],
      ]),
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.message).toContain('one consistent override URL')
  })

  it('says nothing when every definition of a container agrees', () => {
    const conflicts = findConflictingContainerOverrides(
      new Map([
        ['wells', 'http://localhost:3001/m.json'],
        ['reports', 'http://localhost:3001/m.json'],
      ]),
      new Map([
        ['wells', 'operations'],
        ['reports', 'operations'],
      ]),
    )

    expect(conflicts).toHaveLength(0)
  })
})
