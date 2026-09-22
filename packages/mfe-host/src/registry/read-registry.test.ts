/**
 * `readRegistry` knows the adapter interface and no adapter, so these cases are written against
 * fake adapters. Each real adapter is tested against its own fixtures in its own package.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  createMfeError,
  isMfeError,
  type MfeAdapter,
  type Registry,
  type RegistryEntry,
  type RejectedRegistryEntry,
} from '@company/mfe-core'

import { readRegistry } from './read-registry.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A registry entry in the shape a framework build publishes. */
function frameworkEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'reports',
    kind: 'app',
    mfe: { contractMajor: 1 },
    manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    ...overrides,
  }
}

/** An entry in the shape an older generation of containers published: no framework version. */
function otherEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'billing',
    otherManifestUrl: 'https://cdn.example.test/billing/manifest.json',
    ...overrides,
  }
}

interface FakeAdapter {
  readonly adapter: MfeAdapter
  readonly detect: ReturnType<typeof vi.fn>
  readonly parse: ReturnType<typeof vi.fn>
}

/**
 * The smallest thing that satisfies the interface: it recognises an entry by one key and reads
 * two fields off it, which is all `readRegistry` ever asks an adapter to do.
 */
function fakeAdapter(
  kind: string,
  options: { readonly marker: string; readonly urlField: string },
): FakeAdapter {
  const detect = vi.fn(
    (raw: unknown): boolean => isRecord(raw) && typeof raw[options.marker] !== 'undefined',
  )

  const parse = vi.fn((raw: unknown): RegistryEntry => {
    const source = raw as Record<string, unknown>
    const id = source['id']
    const manifestUrl = source[options.urlField]

    if (typeof id !== 'string' || typeof manifestUrl !== 'string') {
      throw createMfeError({
        code: 'registry/invalid-entry',
        id: typeof id === 'string' ? id : '<unknown>',
        operation: `read ${kind} registry entry`,
        expected: `an id and a ${options.urlField}`,
        observed: 'an entry missing one of them',
      })
    }

    return { id, definitionKind: 'app', adapter: kind, manifestUrl }
  })

  return {
    adapter: { kind, detect, parse, is: (entry): entry is RegistryEntry => entry.adapter === kind },
    detect,
    parse,
  }
}

function framework(): FakeAdapter {
  return fakeAdapter('framework', { marker: 'mfe', urlField: 'manifestUrl' })
}

function other(): FakeAdapter {
  return fakeAdapter('other', { marker: 'otherManifestUrl', urlField: 'otherManifestUrl' })
}

function acceptedEntry(registry: Registry, id: string): RegistryEntry {
  const entry = registry.entries.get(id)
  if (!entry) throw new Error(`expected "${id}" to be accepted`)
  return entry
}

function rejectedEntry(registry: Registry, id: string): RejectedRegistryEntry {
  const entry = registry.rejected.find(candidate => candidate.id === id)
  if (!entry) throw new Error(`expected "${id}" to be rejected`)
  return entry
}

function codeOf(error: Error): string {
  return isMfeError(error) ? error.code : `<plain Error: ${error.message}>`
}

/** One adapter, which is what most cases exercise. */
function read(sources: readonly unknown[], overrides?: ReadonlyMap<string, string>): Registry {
  return readRegistry(sources, {
    adapters: [framework().adapter],
    ...(overrides === undefined ? {} : { overrides }),
  })
}

describe('recognising an entry', () => {
  it('reads an entry through the one adapter that recognises it', () => {
    const second = other()

    const registry = readRegistry([frameworkEntry()], {
      adapters: [framework().adapter, second.adapter],
    })

    expect(registry.rejected).toEqual([])
    expect(acceptedEntry(registry, 'reports')).toMatchObject({
      id: 'reports',
      adapter: 'framework',
      definitionKind: 'app',
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    })
    expect(second.parse).not.toHaveBeenCalled()
  })

  it('reads an entry the other adapter recognises, whichever order they were registered in', () => {
    const forwards = readRegistry([otherEntry()], {
      adapters: [framework().adapter, other().adapter],
    })
    const backwards = readRegistry([otherEntry()], {
      adapters: [other().adapter, framework().adapter],
    })

    for (const registry of [forwards, backwards]) {
      expect(registry.rejected).toEqual([])
      expect(acceptedEntry(registry, 'billing')).toMatchObject({
        id: 'billing',
        adapter: 'other',
        manifestUrl: 'https://cdn.example.test/billing/manifest.json',
      })
    }
  })

  it('rejects an entry no adapter recognised', () => {
    const registry = readRegistry([{ id: 'mystery', url: '/somewhere' }], {
      adapters: [framework().adapter, other().adapter],
    })

    expect(registry.entries.size).toBe(0)
    const rejected = rejectedEntry(registry, 'mystery')
    expect(rejected.reason).toBe('no adapter recognised this entry')
    expect(codeOf(rejected.error)).toBe('registry/invalid-entry')
    expect(rejected.error.message).toContain('framework, other')
    expect(rejected.error.message).toContain('Nobody hand-writes registry JSON')
  })

  it('rejects an entry two adapters recognised, naming both of them', () => {
    // Every field both adapters look for, which is exactly the ambiguity to report.
    const ambiguous = { ...frameworkEntry(), ...otherEntry({ id: 'reports' }) }
    const second = other()

    const registry = readRegistry([ambiguous], {
      adapters: [framework().adapter, second.adapter],
    })

    expect(registry.entries.size).toBe(0)
    const rejected = rejectedEntry(registry, 'reports')
    expect(rejected.reason).toBe('more than one adapter recognised this entry (framework, other)')
    expect(codeOf(rejected.error)).toBe('registry/invalid-entry')
    expect(second.parse).not.toHaveBeenCalled()
  })

  it('rejects the entry rather than letting the second adapter read it', () => {
    // A framework entry that is also complete legacy metadata: a fallback would look plausible.
    const second = other()

    const registry = readRegistry([{ ...frameworkEntry(), otherManifestUrl: '/b.json' }], {
      adapters: [framework().adapter, second.adapter],
    })

    expect(registry.entries.size).toBe(0)
    expect(registry.rejected).toHaveLength(1)
    expect(second.parse).not.toHaveBeenCalled()
  })

  it('reports the reason when the recognising adapter rejects the entry itself', () => {
    const registry = read([frameworkEntry({ manifestUrl: 17 })])

    expect(registry.entries.size).toBe(0)
    const rejected = rejectedEntry(registry, 'reports')
    expect(rejected.reason).toBe('the framework adapter rejected this entry')
    expect(codeOf(rejected.error)).toBe('registry/invalid-entry')
    expect(rejected.error.message).toContain('an id and a manifestUrl')
  })

  it('keeps the adapter’s own error code rather than recoding it', () => {
    const unsupported: MfeAdapter = {
      kind: 'framework',
      detect: raw => isRecord(raw) && 'mfe' in raw,
      parse: () => {
        throw createMfeError({
          code: 'contract/unsupported-major',
          id: 'reports',
          operation: 'read the framework version the container was built for',
          expected: 'contract major 1',
          observed: 'contract major 2',
          repair: 'Upgrade the shell, or redeploy the container against the shell’s major.',
        })
      },
      is: (entry): entry is RegistryEntry => entry.adapter === 'framework',
    }

    const registry = readRegistry([frameworkEntry()], { adapters: [unsupported] })

    expect(codeOf(rejectedEntry(registry, 'reports').error)).toBe('contract/unsupported-major')
    expect(rejectedEntry(registry, 'reports').error.message).toContain('Upgrade the shell')
  })

  it('labels an unrecognisable entry by position when it has no readable id', () => {
    const registry = read(['not-an-object', 42])

    expect(registry.rejected.map(entry => entry.id)).toEqual([
      '<entry at index 0>',
      '<entry at index 1>',
    ])
  })

  it('treats an adapter that throws while detecting as not recognising the entry', () => {
    const exploding: MfeAdapter = {
      kind: 'exploding',
      detect: () => {
        throw new Error('detection blew up')
      },
      parse: () => {
        throw new Error('should never run')
      },
      is: (entry): entry is RegistryEntry => entry.adapter === 'exploding',
    }

    const registry = readRegistry([frameworkEntry()], {
      adapters: [exploding, framework().adapter],
    })

    expect(acceptedEntry(registry, 'reports').adapter).toBe('framework')
  })
})

describe('per-entry validation', () => {
  it('keeps unrelated valid entries when one entry is malformed', () => {
    const registry = readRegistry(
      [
        frameworkEntry({ id: 'reports' }),
        frameworkEntry({ id: 'operations', manifestUrl: 17 }),
        otherEntry({ id: 'billing' }),
      ],
      { adapters: [framework().adapter, other().adapter] },
    )

    expect([...registry.entries.keys()].sort()).toEqual(['billing', 'reports'])
    expect(registry.rejected.map(entry => entry.id)).toEqual(['operations'])
  })

  it('rejects a definition id that would not survive as a storage prefix or CSS scope', () => {
    const registry = read([frameworkEntry({ id: 'Reports_Archive' })])

    expect(registry.entries.size).toBe(0)
    const rejected = rejectedEntry(registry, 'Reports_Archive')
    expect(rejected.reason).toBe('invalid definition id')
    expect(codeOf(rejected.error)).toBe('registry/invalid-entry')
    expect(rejected.error.message).toContain('lower-case letters')
  })

  it('carries whatever the adapter put on the entry through untouched', () => {
    const withExtras: MfeAdapter = {
      kind: 'framework',
      detect: raw => isRecord(raw) && 'mfe' in raw,
      parse: () => ({
        id: 'reports',
        definitionKind: 'app',
        adapter: 'framework',
        manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
        version: '2.1.0',
        title: 'Reports',
        icon: 'chart',
        hidden: true,
        tags: ['ops'],
        build: { hash: '1e485caec528f7fa' },
      }),
      is: (entry): entry is RegistryEntry => entry.adapter === 'framework',
    }

    const registry = readRegistry([frameworkEntry()], { adapters: [withExtras] })

    expect(acceptedEntry(registry, 'reports')).toMatchObject({
      version: '2.1.0',
      title: 'Reports',
      icon: 'chart',
      hidden: true,
      tags: ['ops'],
      build: { hash: '1e485caec528f7fa' },
    })
  })
})

describe('duplicate definition ids', () => {
  it('removes every entry using a duplicated id instead of letting one win', () => {
    const first = frameworkEntry({ id: 'reports', manifestUrl: 'https://a.test/mf-manifest.json' })
    const second = frameworkEntry({ id: 'reports', manifestUrl: 'https://b.test/mf-manifest.json' })

    const registry = read([first, frameworkEntry({ id: 'billing' }), second])

    expect(registry.entries.has('reports')).toBe(false)
    expect([...registry.entries.keys()]).toEqual(['billing'])
  })

  it('reports every conflicting entry, naming all of their positions', () => {
    const sources = [
      frameworkEntry({ id: 'reports' }),
      frameworkEntry({ id: 'reports' }),
      frameworkEntry({ id: 'reports' }),
    ]

    const registry = read(sources)

    expect(registry.rejected).toHaveLength(3)
    expect(registry.rejected.map(entry => entry.source)).toEqual(sources)
    for (const rejected of registry.rejected) {
      expect(rejected.reason).toBe('duplicate definition id "reports"')
      expect(codeOf(rejected.error)).toBe('registry/duplicate-id')
      expect(rejected.error.message).toContain('3 entries using "reports"')
      expect(rejected.error.message).toContain('at indexes 0, 1, 2')
    }
  })

  it('detects a duplicate id even when the two entries belong to different adapters', () => {
    const registry = readRegistry(
      [frameworkEntry({ id: 'billing' }), otherEntry({ id: 'billing' })],
      { adapters: [framework().adapter, other().adapter] },
    )

    expect(registry.entries.size).toBe(0)
    expect(registry.rejected).toHaveLength(2)
    expect(codeOf(rejectedEntry(registry, 'billing').error)).toBe('registry/duplicate-id')
  })

  it('produces the same result regardless of the order the duplicates arrive in', () => {
    const a = frameworkEntry({ id: 'reports', title: 'A' })
    const b = frameworkEntry({ id: 'reports', title: 'B' })

    const forwards = read([a, b, frameworkEntry({ id: 'billing' })])
    const backwards = read([b, a, frameworkEntry({ id: 'billing' })])

    expect([...forwards.entries.keys()]).toEqual([...backwards.entries.keys()])
    expect(forwards.rejected).toHaveLength(backwards.rejected.length)
  })
})

describe('boot-time URL overrides', () => {
  it('replaces the manifest URL and marks the entry as overridden', () => {
    const registry = read(
      [frameworkEntry({ id: 'reports' })],
      new Map([['reports', 'http://localhost:3001/mf-manifest.json']]),
    )

    expect(acceptedEntry(registry, 'reports')).toMatchObject({
      manifestUrl: 'http://localhost:3001/mf-manifest.json',
      overridden: true,
    })
  })

  it('leaves entries that were not overridden unmarked', () => {
    const registry = read(
      [frameworkEntry({ id: 'reports' }), frameworkEntry({ id: 'billing' })],
      new Map([['reports', 'http://localhost:3001/mf-manifest.json']]),
    )

    const billing = acceptedEntry(registry, 'billing')
    expect(billing.overridden).toBeUndefined()
    expect(billing.manifestUrl).toBe('https://cdn.example.test/reports/mf-manifest.json')
  })

  it('does not resurrect an entry the adapter rejected', () => {
    const registry = read(
      [frameworkEntry({ id: 'reports', manifestUrl: 17 })],
      new Map([['reports', 'http://localhost:3001/mf-manifest.json']]),
    )

    expect(registry.entries.size).toBe(0)
  })
})
