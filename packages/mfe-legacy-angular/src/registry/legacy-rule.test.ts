import { describe, expect, it } from 'vitest'

import { isMfeError, type NeutralRegistryEntry } from '@company/mfe-core'
import { createMfeContractRule, normalizeRegistry } from '@company/mfe-host'

import { readLegacyAdapterData } from './legacy-config.ts'
import { createLegacyAdapterRule, deriveLegacyDefinitionId } from './legacy-rule.ts'

/**
 * A registry entry in the shape the legacy shell publishes, with every field
 * the old `AppConfig` carried populated. This is a contract fixture: the legacy
 * applications are not available here, so it stands in for what they publish.
 */
function legacyEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'asset-tracker',
    title: 'Asset Tracker',
    icon: 'clipboard',
    mfManifestUrl: 'https://cdn.example.test/asset-tracker/mf-manifest.json',
    onboardingType: 'guided',
    tags: ['assets', 'field-service'],
    categories: ['operations'],
    version: '4.7.1',
    externalUrl: 'https://docs.example.test/asset-tracker',
    routes: ['/asset-tracker', '/asset-tracker/sites'],
    settings: { routes: ['/asset-tracker/settings', '/asset-tracker/settings/alerts'] },
    ...overrides,
  }
}

/** The legacy vocabulary that must not survive into the neutral record. */
const LEGACY_FIELD_NAMES = [
  'name',
  'mfManifestUrl',
  'onboardingType',
  'tags',
  'categories',
  'externalUrl',
  'routes',
  'settings',
]

const rule = createLegacyAdapterRule()

function normalized(source: Record<string, unknown>): NeutralRegistryEntry {
  return rule.normalize(source)
}

describe('createLegacyAdapterRule advertises', () => {
  it('claims an entry that has legacy metadata and no advertised framework contract', () => {
    const source = legacyEntry()

    const claimed = rule.advertises(source)

    expect(claimed).toBe(true)
  })

  /**
   * The no-silent-fallback guarantee. An entry that advertises the new contract
   * belongs to the new adapter whatever state that advertisement is in; if this
   * rule claimed it, a typo in new metadata would quietly change how the app
   * loads instead of failing.
   */
  describe('never claims an entry that advertises the framework contract', () => {
    const malformed: readonly (readonly [string, unknown])[] = [
      ['a contract major of the wrong type', { contractMajor: 'one' }],
      ['an unsupported contract major', { contractMajor: 99 }],
      ['an empty contract object', {}],
      ['a contract that is a string', 'v1'],
      ['a contract that is null', null],
      ['a contract that is undefined', undefined],
      ['a contract that is an array', []],
    ]

    for (const [description, mfe] of malformed) {
      it(`refuses an entry with ${description}, even with complete legacy metadata`, () => {
        const source = legacyEntry({ mfe })

        const claimed = rule.advertises(source)

        expect(claimed).toBe(false)
      })
    }
  })

  it('refuses an entry without an app name', () => {
    expect(rule.advertises(legacyEntry({ name: undefined }))).toBe(false)
  })

  it('refuses an entry whose app name is blank', () => {
    expect(rule.advertises(legacyEntry({ name: '   ' }))).toBe(false)
  })

  it('refuses an entry without a legacy manifest URL', () => {
    expect(rule.advertises(legacyEntry({ mfManifestUrl: undefined }))).toBe(false)
  })

  it('refuses values that are not registry objects', () => {
    expect(rule.advertises(null)).toBe(false)
    expect(rule.advertises('asset-tracker')).toBe(false)
    expect(rule.advertises([legacyEntry()])).toBe(false)
  })
})

describe('createLegacyAdapterRule normalize', () => {
  it('translates identity, manifest URL and presentation into the neutral record', () => {
    const entry = normalized(legacyEntry())

    expect(entry).toMatchObject({
      id: 'asset-tracker',
      definitionKind: 'app',
      adapter: 'legacy-angular',
      manifestUrl: 'https://cdn.example.test/asset-tracker/mf-manifest.json',
      title: 'Asset Tracker',
      icon: 'clipboard',
      version: '4.7.1',
    })
  })

  it('keeps every legacy field out of the neutral record and in the adapter payload', () => {
    const entry = normalized(legacyEntry())

    for (const field of LEGACY_FIELD_NAMES) expect(Object.keys(entry)).not.toContain(field)
    expect(readLegacyAdapterData(entry)).toEqual({
      containerName: 'asset-tracker',
      exposeName: './single-spa-app',
      navigationOwnership: 'shell',
      onboardingType: 'guided',
      tags: ['assets', 'field-service'],
      categories: ['operations'],
      externalUrl: 'https://docs.example.test/asset-tracker',
      routes: ['/asset-tracker', '/asset-tracker/sites'],
      settingsRoutes: ['/asset-tracker/settings', '/asset-tracker/settings/alerts'],
    })
  })

  it('flattens settings.routes into the adapter payload', () => {
    const entry = normalized(legacyEntry({ settings: { routes: ['/rigstream/settings'] } }))

    expect(readLegacyAdapterData(entry).settingsRoutes).toEqual(['/rigstream/settings'])
  })

  it('marks a hidden legacy app hidden in the neutral record', () => {
    const entry = normalized(legacyEntry({ hidden: true }))

    expect(entry.hidden).toBe(true)
  })

  it('omits presentation fields the legacy entry did not carry', () => {
    const entry = normalized(
      legacyEntry({ title: undefined, icon: undefined, version: undefined, hidden: undefined }),
    )

    expect('title' in entry).toBe(false)
    expect('icon' in entry).toBe(false)
    expect('version' in entry).toBe(false)
    expect('hidden' in entry).toBe(false)
  })

  it('substitutes empty collections for the legacy fields an entry omitted', () => {
    const entry = normalized({
      name: 'rigstream',
      mfManifestUrl: 'https://cdn.example.test/rigstream/mf-manifest.json',
    })

    expect(readLegacyAdapterData(entry)).toEqual({
      containerName: 'rigstream',
      exposeName: './single-spa-app',
      navigationOwnership: 'shell',
      tags: [],
      categories: [],
      routes: [],
      settingsRoutes: [],
    })
  })

  it('records that legacy apps are routed by the shell, not by themselves', () => {
    const entry = normalized(legacyEntry())

    expect(readLegacyAdapterData(entry).navigationOwnership).toBe('shell')
  })

  it('preserves the legacy name as the container name the loader registers', () => {
    const entry = normalized(legacyEntry({ name: 'AssetTracker' }))

    expect(entry.id).toBe('asset-tracker')
    expect(readLegacyAdapterData(entry).containerName).toBe('AssetTracker')
  })
})

describe('deriveLegacyDefinitionId', () => {
  it('leaves an already hyphenated legacy name untouched', () => {
    expect(deriveLegacyDefinitionId('asset-tracker')).toBe('asset-tracker')
  })

  it('splits a camel-cased legacy name at its word boundaries', () => {
    expect(deriveLegacyDefinitionId('AssetTracker')).toBe('asset-tracker')
  })

  it('reduces separators and casing to the framework identity rules', () => {
    expect(deriveLegacyDefinitionId('Solutions Health')).toBe('solutions-health')
    expect(deriveLegacyDefinitionId('rig_stream.v2')).toBe('rig-stream-v2')
  })
})

describe('createLegacyAdapterRule normalize failures', () => {
  it('names the missing app name and what it is used for', () => {
    let thrown: unknown
    try {
      normalized(legacyEntry({ name: undefined }))
    } catch (error) {
      thrown = error
    }

    expect(isMfeError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ code: 'registry/invalid-descriptor', path: ['name'] })
    expect((thrown as Error).message).toContain('Set the app name in the shell registry entry')
  })

  it('names the missing manifest URL', () => {
    expect(() => normalized(legacyEntry({ mfManifestUrl: '' }))).toThrow(
      /failed to translate legacy registry entry mfManifestUrl/,
    )
  })

  it('rejects a name that cannot become a definition id', () => {
    let thrown: unknown
    try {
      normalized(legacyEntry({ name: '///' }))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'registry/invalid-descriptor' })
    expect((thrown as Error).message).toContain('lower-case letters, digits and single hyphens')
  })

  it('names the field and the expected shape when a legacy list is malformed', () => {
    let thrown: unknown
    try {
      normalized(legacyEntry({ tags: ['assets', 7] }))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'registry/invalid-descriptor', path: ['tags'] })
    expect((thrown as Error).message).toContain('an array containing a non-string')
  })

  it('names settings.routes by its full path', () => {
    let thrown: unknown
    try {
      normalized(legacyEntry({ settings: { routes: 'all' } }))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ path: ['settings', 'routes'] })
  })

  it('rejects a settings block that is not an object', () => {
    expect(() => normalized(legacyEntry({ settings: 'routes' }))).toThrow(/settings/)
  })

  it('rejects a descriptor that is not an object', () => {
    expect(() => rule.normalize('asset-tracker')).toThrow(/expected an object/)
  })
})

describe('readLegacyAdapterData', () => {
  it('refuses an entry that belongs to another adapter', () => {
    const reactEntry: NeutralRegistryEntry = {
      id: 'reports',
      definitionKind: 'app',
      adapter: 'react',
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    }

    expect(() => readLegacyAdapterData(reactEntry)).toThrow(
      /an entry claimed by the legacy adapter/,
    )
  })

  it('refuses a hand-assembled entry with no adapter payload', () => {
    const handAssembled: NeutralRegistryEntry = {
      id: 'asset-tracker',
      definitionKind: 'app',
      adapter: 'legacy-angular',
      manifestUrl: 'https://cdn.example.test/asset-tracker/mf-manifest.json',
    }

    expect(() => readLegacyAdapterData(handAssembled)).toThrow(
      /createLegacyAdapterRule\(\)\.normalize/,
    )
  })
})

describe('the legacy rule inside the shell selection table', () => {
  const rules = [createMfeContractRule(), createLegacyAdapterRule()]

  it('accepts a legacy entry that reaches it after the framework contract rule', () => {
    const registry = normalizeRegistry([legacyEntry()], { rules })

    expect(registry.quarantined).toEqual([])
    expect(registry.entries.get('asset-tracker')?.adapter).toBe('legacy-angular')
  })

  it('quarantines a malformed framework contract instead of loading it as legacy', () => {
    const source = legacyEntry({ mfe: { contractMajor: 'one' }, id: 'asset-tracker', kind: 'app' })

    const registry = normalizeRegistry([source], { rules })

    expect(registry.entries.size).toBe(0)
    expect(registry.quarantined).toHaveLength(1)
    expect(registry.quarantined[0]?.reason).toContain('react')
  })

  it('keeps a valid legacy entry when a malformed one is quarantined beside it', () => {
    const registry = normalizeRegistry(
      [legacyEntry({ mfe: {} }), legacyEntry({ name: 'rigstream' })],
      { rules },
    )

    expect([...registry.entries.keys()]).toEqual(['rigstream'])
    expect(registry.quarantined).toHaveLength(1)
  })
})
