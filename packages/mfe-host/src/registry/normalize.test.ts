import { describe, expect, it, vi, type Mock } from 'vitest'

import {
  createMfeError,
  isMfeError,
  type AdapterSelectionRule,
  type NeutralRegistryEntry,
  type NormalizedRegistry,
  type QuarantinedRegistryEntry,
} from '@company/mfe-core'

import { createMfeContractRule } from './mfe-contract-rule.ts'
import { normalizeRegistry } from './normalize.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A registry entry as the build plugin emits it for the current contract. */
function advertisedEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'reports',
    kind: 'app',
    mfe: { contractMajor: 1 },
    manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    ...overrides,
  }
}

/**
 * A descriptor in the shape the previous generation of containers published:
 * no advertised contract, a differently named manifest field and route
 * metadata the legacy adapter translates at its own boundary.
 */
function legacyEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'billing',
    mfManifestUrl: 'https://cdn.example.test/billing/manifest.json',
    routes: ['/billing'],
    ...overrides,
  }
}

/**
 * Stands in for the legacy adapter's real selection rule. It only exists to
 * prove two things about the selection table: that an entry with legacy
 * metadata and no advertised contract reaches it, and that an entry with a
 * broken advertised contract never does.
 */
function createLegacyRule(): {
  readonly rule: AdapterSelectionRule
  readonly advertises: Mock<(source: unknown) => boolean>
  readonly normalize: Mock<(source: unknown) => NeutralRegistryEntry>
} {
  const advertises = vi.fn(
    (source: unknown): boolean =>
      isRecord(source) &&
      typeof source['mfManifestUrl'] === 'string' &&
      Array.isArray(source['routes']),
  )

  const normalizeEntry = vi.fn((source: unknown): NeutralRegistryEntry => {
    const descriptor = source as Record<string, unknown>
    const id = descriptor['id']
    const manifestUrl = descriptor['mfManifestUrl']
    if (typeof id !== 'string' || typeof manifestUrl !== 'string') {
      throw createMfeError({
        code: 'registry/invalid-descriptor',
        id: typeof id === 'string' ? id : '<unknown>',
        operation: 'translate legacy registry entry',
        expected: 'an id and an mfManifestUrl',
        observed: 'a descriptor missing one of them',
      })
    }
    return {
      id,
      definitionKind: 'app',
      adapter: 'legacy-angular',
      manifestUrl,
      adapterData: { routes: descriptor['routes'] },
    }
  })

  return {
    rule: { adapter: 'legacy-angular', advertises, normalize: normalizeEntry },
    advertises,
    normalize: normalizeEntry,
  }
}

function acceptedEntry(registry: NormalizedRegistry, id: string): NeutralRegistryEntry {
  const entry = registry.entries.get(id)
  if (!entry) throw new Error(`expected "${id}" to be accepted`)
  return entry
}

function quarantinedEntry(registry: NormalizedRegistry, id: string): QuarantinedRegistryEntry {
  const entry = registry.quarantined.find(candidate => candidate.id === id)
  if (!entry) throw new Error(`expected "${id}" to be quarantined`)
  return entry
}

function codeOf(error: Error): string {
  return isMfeError(error) ? error.code : `<plain Error: ${error.message}>`
}

/** The framework rule alone, which is what most cases exercise. */
function normalize(
  sources: readonly unknown[],
  overrides?: ReadonlyMap<string, string>,
): NormalizedRegistry {
  return normalizeRegistry(sources, {
    rules: [createMfeContractRule()],
    ...(overrides === undefined ? {} : { overrides }),
  })
}

describe('adapter selection', () => {
  it('selects the new adapter for an entry advertising a valid contract', () => {
    const legacy = createLegacyRule()

    const registry = normalizeRegistry([advertisedEntry()], {
      rules: [createMfeContractRule(), legacy.rule],
    })

    expect(registry.quarantined).toEqual([])
    expect(acceptedEntry(registry, 'reports')).toMatchObject({
      id: 'reports',
      adapter: 'react',
      definitionKind: 'app',
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    })
    expect(legacy.normalize).not.toHaveBeenCalled()
  })

  it('selects the legacy adapter when nothing advertises the new contract', () => {
    const legacy = createLegacyRule()

    const registry = normalizeRegistry([legacyEntry()], {
      rules: [createMfeContractRule(), legacy.rule],
    })

    expect(registry.quarantined).toEqual([])
    expect(acceptedEntry(registry, 'billing')).toMatchObject({
      id: 'billing',
      adapter: 'legacy-angular',
      manifestUrl: 'https://cdn.example.test/billing/manifest.json',
    })
    expect(legacy.normalize).toHaveBeenCalledTimes(1)
  })

  it('reports a contract error for a malformed advertised contract and never falls back to legacy', () => {
    // an entry that claims the new contract *and* still carries every
    // piece of legacy metadata, so a fallback would look plausible.
    const legacy = createLegacyRule()
    const ambiguous = {
      id: 'reports',
      kind: 'app',
      mfe: { contractMajor: 'one' },
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
      mfManifestUrl: 'https://cdn.example.test/reports/manifest.json',
      routes: ['/reports'],
    }

    const registry = normalizeRegistry([ambiguous], {
      rules: [createMfeContractRule(), legacy.rule],
    })

    // quarantined with an explicit descriptor error, and the legacy
    // rule was never given the chance to claim it.
    expect(registry.entries.size).toBe(0)
    const quarantined = quarantinedEntry(registry, 'reports')
    expect(codeOf(quarantined.error)).toBe('registry/invalid-descriptor')
    expect(quarantined.reason).toContain('react')
    expect(quarantined.error.message).toContain('contract major')
    expect(legacy.normalize).not.toHaveBeenCalled()
    expect(registry.quarantined).toHaveLength(1)
  })

  it('reports an unsupported contract major rather than quietly skipping the entry', () => {
    const registry = normalize([advertisedEntry({ mfe: { contractMajor: 2 } })])

    expect(registry.entries.size).toBe(0)
    const quarantined = quarantinedEntry(registry, 'reports')
    expect(codeOf(quarantined.error)).toBe('contract/unsupported-major')
    expect(quarantined.error.message).toContain('Upgrade the shell')
  })

  it('quarantines a descriptor no adapter recognises', () => {
    const legacy = createLegacyRule()

    const registry = normalizeRegistry([{ id: 'mystery', url: '/somewhere' }], {
      rules: [createMfeContractRule(), legacy.rule],
    })

    expect(registry.entries.size).toBe(0)
    const quarantined = quarantinedEntry(registry, 'mystery')
    expect(quarantined.reason).toBe('no adapter recognised this descriptor')
    expect(codeOf(quarantined.error)).toBe('registry/invalid-descriptor')
    expect(quarantined.error.message).toContain('react, legacy-angular')
  })

  it('labels an unrecognisable descriptor by position when it has no readable id', () => {
    const registry = normalize(['not-an-object', 42])

    expect(registry.quarantined.map(entry => entry.id)).toEqual([
      '<entry at index 0>',
      '<entry at index 1>',
    ])
  })

  it('treats a rule that throws while detecting its own contract as not owning the entry', () => {
    const exploding: AdapterSelectionRule = {
      adapter: 'legacy-angular',
      advertises: () => {
        throw new Error('detection blew up')
      },
      normalize: () => {
        throw new Error('should never run')
      },
    }

    const registry = normalizeRegistry([advertisedEntry()], {
      rules: [exploding, createMfeContractRule()],
    })

    expect(acceptedEntry(registry, 'reports').adapter).toBe('react')
  })
})

describe('per-entry validation', () => {
  it('keeps unrelated valid entries when one entry is malformed', () => {
    const legacy = createLegacyRule()

    const registry = normalizeRegistry(
      [
        advertisedEntry({ id: 'reports' }),
        advertisedEntry({ id: 'operations', manifestUrl: 17 }),
        legacyEntry({ id: 'billing' }),
      ],
      { rules: [createMfeContractRule(), legacy.rule] },
    )

    expect([...registry.entries.keys()].sort()).toEqual(['billing', 'reports'])
    expect(registry.quarantined.map(entry => entry.id)).toEqual(['operations'])
    expect(quarantinedEntry(registry, 'operations').error.message).toContain('manifest URL')
  })

  it('rejects a definition id that would not survive as a storage prefix or CSS scope', () => {
    const registry = normalize([advertisedEntry({ id: 'Reports_Archive' })])

    expect(registry.entries.size).toBe(0)
    const quarantined = quarantinedEntry(registry, 'Reports_Archive')
    expect(quarantined.reason).toBe('invalid definition id')
    expect(codeOf(quarantined.error)).toBe('registry/invalid-descriptor')
    expect(quarantined.error.message).toContain('lower-case letters')
  })

  it('rejects an entry whose kind is neither app nor widget', () => {
    const registry = normalize([advertisedEntry({ kind: 'page' })])

    expect(quarantinedEntry(registry, 'reports').error.message).toContain('"app" or "widget"')
  })

  it('rejects an entry that advertises the contract without an id', () => {
    const registry = normalize([advertisedEntry({ id: undefined })])

    expect(registry.entries.size).toBe(0)
    expect(quarantinedEntry(registry, '<entry at index 0>').error.message).toContain(
      'read definition id',
    )
  })

  it('rejects an advertised contract marker that is not an object', () => {
    const registry = normalize([advertisedEntry({ mfe: true })])

    expect(quarantinedEntry(registry, 'reports').error.message).toContain('{ "contractMajor": 1 }')
  })
})

describe('duplicate definition ids', () => {
  it('removes every entry claiming a duplicated id instead of letting one win', () => {
    const first = advertisedEntry({ id: 'reports', manifestUrl: 'https://a.test/mf-manifest.json' })
    const second = advertisedEntry({
      id: 'reports',
      manifestUrl: 'https://b.test/mf-manifest.json',
    })

    const registry = normalize([first, advertisedEntry({ id: 'billing' }), second])

    // Neither "last wins" nor "first wins": the id is unusable until a human
    // renames one of them.
    expect(registry.entries.has('reports')).toBe(false)
    expect([...registry.entries.keys()]).toEqual(['billing'])
  })

  it('reports every conflicting entry, naming all of their positions', () => {
    const first = advertisedEntry({ id: 'reports' })
    const second = advertisedEntry({ id: 'reports' })
    const third = advertisedEntry({ id: 'reports' })

    const registry = normalize([first, second, third])

    expect(registry.quarantined).toHaveLength(3)
    expect(registry.quarantined.map(entry => entry.source)).toEqual([first, second, third])
    for (const quarantined of registry.quarantined) {
      expect(quarantined.reason).toBe('duplicate definition id "reports"')
      expect(codeOf(quarantined.error)).toBe('registry/duplicate-id')
      expect(quarantined.error.message).toContain('3 entries claiming "reports"')
      expect(quarantined.error.message).toContain('at indexes 0, 1, 2')
    }
  })

  it('detects a duplicate id even when the two entries belong to different adapters', () => {
    const legacy = createLegacyRule()

    const registry = normalizeRegistry(
      [advertisedEntry({ id: 'billing' }), legacyEntry({ id: 'billing' })],
      { rules: [createMfeContractRule(), legacy.rule] },
    )

    expect(registry.entries.size).toBe(0)
    expect(registry.quarantined).toHaveLength(2)
    expect(codeOf(quarantinedEntry(registry, 'billing').error)).toBe('registry/duplicate-id')
  })

  it('produces the same result regardless of the order the duplicates arrive in', () => {
    const rules = [createMfeContractRule()]
    const a = advertisedEntry({ id: 'reports', title: 'A' })
    const b = advertisedEntry({ id: 'reports', title: 'B' })

    const forwards = normalizeRegistry([a, b, advertisedEntry({ id: 'billing' })], { rules })
    const backwards = normalizeRegistry([b, a, advertisedEntry({ id: 'billing' })], { rules })

    expect([...forwards.entries.keys()]).toEqual([...backwards.entries.keys()])
    expect(forwards.quarantined).toHaveLength(backwards.quarantined.length)
  })
})

describe('boot-time URL overrides', () => {
  it('replaces the manifest URL and marks the entry as overridden', () => {
    const registry = normalize(
      [advertisedEntry({ id: 'reports' })],
      new Map([['reports', 'http://localhost:3001/mf-manifest.json']]),
    )

    expect(acceptedEntry(registry, 'reports')).toMatchObject({
      manifestUrl: 'http://localhost:3001/mf-manifest.json',
      overridden: true,
    })
  })

  it('leaves entries that were not overridden unmarked', () => {
    const registry = normalize(
      [advertisedEntry({ id: 'reports' }), advertisedEntry({ id: 'billing' })],
      new Map([['reports', 'http://localhost:3001/mf-manifest.json']]),
    )

    const billing = acceptedEntry(registry, 'billing')
    expect(billing.overridden).toBeUndefined()
    expect(billing.manifestUrl).toBe('https://cdn.example.test/reports/mf-manifest.json')
  })

  it('does not resurrect an entry that failed validation', () => {
    const registry = normalize(
      [advertisedEntry({ id: 'reports', kind: 'page' })],
      new Map([['reports', 'http://localhost:3001/mf-manifest.json']]),
    )

    expect(registry.entries.size).toBe(0)
  })
})

/**
 * A host has to render a Widget catalogue before it fetches anything, so what a
 * Widget takes travels in the registry rather than behind a container load.
 */
describe('published Widget contract', () => {
  const contract = {
    events: ['acknowledged', 'dismissed'],
    inputs: {
      type: 'object',
      properties: { alertId: { type: 'string' }, severity: { enum: ['info', 'critical'] } },
      required: ['alertId'],
      additionalProperties: false,
    },
  }

  it('carries the inputs schema and event names through to the neutral entry', () => {
    const registry = normalize([advertisedEntry({ id: 'alert-panel', kind: 'widget', contract })])

    expect(acceptedEntry(registry, 'alert-panel').contract).toEqual(contract)
  })

  /**
   * "Takes nothing" and "the build could not read the schema" call for
   * different behaviour in a catalogue, so an unread schema is absent rather
   * than an empty object standing in for one.
   */
  it('accepts a contract that publishes events without an inputs schema', () => {
    const registry = normalize([
      advertisedEntry({ id: 'alert-panel', kind: 'widget', contract: { events: ['dismissed'] } }),
    ])

    const published = acceptedEntry(registry, 'alert-panel').contract
    expect(published).toEqual({ events: ['dismissed'] })
    expect(published && 'inputs' in published).toBe(false)
  })

  it('rejects a Widget contract on an App', () => {
    const registry = normalize([advertisedEntry({ contract })])

    expect(registry.entries.size).toBe(0)
    expect(quarantinedEntry(registry, 'reports').error.message).toContain(
      'An App has no inputs and no events',
    )
  })

  it('rejects a contract whose events are not names', () => {
    const registry = normalize([
      advertisedEntry({ id: 'alert-panel', kind: 'widget', contract: { events: [{}] } }),
    ])

    expect(quarantinedEntry(registry, 'alert-panel').error.message).toContain(
      'an array of event names',
    )
  })

  it('rejects a contract that is not an object', () => {
    const registry = normalize([
      advertisedEntry({ id: 'alert-panel', kind: 'widget', contract: 'acknowledged' }),
    ])

    expect(registry.entries.size).toBe(0)
  })
})

describe('advertised capabilities', () => {
  it('carries App capabilities through to the neutral entry', () => {
    const registry = normalize([
      advertisedEntry({
        capabilities: [
          { name: 'settings', label: 'Report settings', path: '/settings' },
          { name: 'help', label: 'Help', path: '/help', icon: 'question-mark' },
          { name: 'releaseNotes', label: 'What is new', path: '/news', icon: { src: '/n.svg' } },
        ],
      }),
    ])

    expect(acceptedEntry(registry, 'reports').capabilities).toEqual([
      { name: 'settings', label: 'Report settings', path: '/settings' },
      { name: 'help', label: 'Help', path: '/help', icon: 'question-mark' },
      { name: 'releaseNotes', label: 'What is new', path: '/news', icon: { src: '/n.svg' } },
    ])
  })

  it('rejects a Widget that advertises capabilities', () => {
    const registry = normalize([
      advertisedEntry({
        id: 'alert-panel',
        kind: 'widget',
        capabilities: [{ name: 'settings', label: 'Settings', path: '/settings' }],
      }),
    ])

    expect(registry.entries.size).toBe(0)
    const quarantined = quarantinedEntry(registry, 'alert-panel')
    expect(quarantined.error.message).toContain('no capabilities on a Widget')
    expect(quarantined.error.message).toContain('Move the capability routes into an App')
  })

  it('rejects a Widget that advertises an empty capability list', () => {
    const registry = normalize([
      advertisedEntry({ id: 'alert-panel', kind: 'widget', capabilities: [] }),
    ])

    expect(registry.entries.size).toBe(0)
  })

  it('rejects a capability name outside the closed set', () => {
    const registry = normalize([
      advertisedEntry({ capabilities: [{ name: 'billing', label: 'Billing', path: '/b' }] }),
    ])

    expect(quarantinedEntry(registry, 'reports').error.message).toContain(
      'settings, help, releaseNotes',
    )
  })

  it('rejects an icon that is neither a shell icon name nor an asset reference', () => {
    const registry = normalize([
      advertisedEntry({
        capabilities: [{ name: 'help', label: 'Help', path: '/h', icon: { svg: '<svg/>' } }],
      }),
    ])

    expect(quarantinedEntry(registry, 'reports').error.message).toContain(
      'an icon name from the shell icon set',
    )
  })

  it('rejects capabilities that are not an array', () => {
    const registry = normalize([advertisedEntry({ capabilities: 'settings' })])

    expect(quarantinedEntry(registry, 'reports').error.message).toContain(
      'an array of capability descriptors',
    )
  })
})

describe('optional descriptor fields', () => {
  it('carries version, title, icon and hidden through, and omits what was absent', () => {
    const registry = normalize([
      advertisedEntry({
        version: '2.1.0',
        title: 'Reports',
        icon: 'chart',
        hidden: true,
      }),
      advertisedEntry({ id: 'billing' }),
    ])

    expect(acceptedEntry(registry, 'reports')).toMatchObject({
      version: '2.1.0',
      title: 'Reports',
      icon: 'chart',
      hidden: true,
    })

    const billing = acceptedEntry(registry, 'billing')
    expect(billing.version).toBeUndefined()
    expect(billing.title).toBeUndefined()
    expect(billing.hidden).toBeUndefined()
  })

  it('treats hidden as an opt-in flag rather than any truthy value', () => {
    const registry = normalize([advertisedEntry({ hidden: 'yes' })])

    expect(acceptedEntry(registry, 'reports').hidden).toBeUndefined()
  })
})

/**
 * The build a container came from is the "which build?" a bug report is
 * otherwise written without. It reaches the registry from the container's own
 * descriptor, so it is validated exactly as loosely as it is trusted: never
 * gating the entry, never passed on as something it is not.
 */
describe('build provenance', () => {
  it('carries the hash and the time through to the neutral entry', () => {
    const registry = normalize([
      advertisedEntry({ build: { hash: '1e485caec528f7fa', time: '2026-09-20T19:10:41.398Z' } }),
    ])

    expect(acceptedEntry(registry, 'reports').build).toEqual({
      hash: '1e485caec528f7fa',
      time: '2026-09-20T19:10:41.398Z',
    })
  })

  it('carries a half-published build rather than losing the half that is there', () => {
    const registry = normalize([advertisedEntry({ build: { hash: '1e485caec528f7fa' } })])

    expect(acceptedEntry(registry, 'reports').build).toEqual({ hash: '1e485caec528f7fa' })
  })

  it('accepts an entry that names no build at all', () => {
    const registry = normalize([advertisedEntry()])

    expect(acceptedEntry(registry, 'reports').build).toBeUndefined()
  })

  it('drops a build it cannot read instead of failing the entry over it', () => {
    const registry = normalize([
      advertisedEntry({ build: 'yesterday' }),
      advertisedEntry({ id: 'billing', build: { hash: 42 } }),
    ])

    expect(acceptedEntry(registry, 'reports').build).toBeUndefined()
    expect(acceptedEntry(registry, 'billing').build).toBeUndefined()
    expect(registry.quarantined).toEqual([])
  })
})
