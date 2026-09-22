import { describe, expect, it } from 'vitest'

import { isMfeError, type MfeAdapter, type MfeError, type RegistryEntry } from '@company/mfe-core'
import { readRegistry } from '@company/mfe-host'

import {
  deriveLegacyDefinitionId,
  legacyAngularAdapter,
  type LegacyRegistryEntry,
} from './legacy-adapter.ts'

/**
 * A registry entry in the shape the legacy shell publishes; the legacy applications are not
 * available here, so this fixture stands in for what they publish (§9).
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

/** The legacy vocabulary the entry is translated out of, so no caller has to know it. */
const LEGACY_FIELD_NAMES = ['name', 'mfManifestUrl', 'settings']

function parse(source: unknown): LegacyRegistryEntry {
  return legacyAngularAdapter.parse(source)
}

function rejection(source: unknown): MfeError {
  try {
    legacyAngularAdapter.parse(source)
  } catch (error) {
    if (isMfeError(error)) return error
    throw error
  }
  throw new Error('expected the adapter to reject the entry')
}

describe('detect', () => {
  it('recognises an entry that has legacy metadata and no framework version', () => {
    expect(legacyAngularAdapter.detect(legacyEntry())).toBe(true)
  })

  // A typo in framework metadata must fail rather than quietly change how an app loads (§9).
  describe('never recognises an entry that carries a framework version', () => {
    const malformed: readonly (readonly [string, unknown])[] = [
      ['a contract major of the wrong type', { contractMajor: 'one' }],
      ['an unsupported contract major', { contractMajor: 99 }],
      ['an empty marker object', {}],
      ['a marker that is a string', 'v1'],
      ['a marker that is null', null],
      ['a marker that is undefined', undefined],
      ['a marker that is an array', []],
    ]

    for (const [description, mfe] of malformed) {
      it(`refuses an entry with ${description}, even with complete legacy metadata`, () => {
        expect(legacyAngularAdapter.detect(legacyEntry({ mfe }))).toBe(false)
      })
    }
  })

  it('refuses an entry without an app name', () => {
    expect(legacyAngularAdapter.detect(legacyEntry({ name: undefined }))).toBe(false)
  })

  it('refuses an entry whose app name is blank', () => {
    expect(legacyAngularAdapter.detect(legacyEntry({ name: '   ' }))).toBe(false)
  })

  it('refuses an entry without a legacy manifest URL', () => {
    expect(legacyAngularAdapter.detect(legacyEntry({ mfManifestUrl: undefined }))).toBe(false)
  })

  it('refuses values that are not registry objects', () => {
    expect(legacyAngularAdapter.detect(null)).toBe(false)
    expect(legacyAngularAdapter.detect('asset-tracker')).toBe(false)
    expect(legacyAngularAdapter.detect([legacyEntry()])).toBe(false)
  })
})

describe('parse', () => {
  it('translates identity, manifest URL and presentation into the registry entry', () => {
    expect(parse(legacyEntry())).toMatchObject({
      id: 'asset-tracker',
      definitionKind: 'app',
      adapter: 'legacy-angular',
      manifestUrl: 'https://cdn.example.test/asset-tracker/mf-manifest.json',
      title: 'Asset Tracker',
      icon: 'clipboard',
      version: '4.7.1',
    })
  })

  it('translates the legacy vocabulary into this adapter’s own typed fields', () => {
    const entry = parse(legacyEntry())

    for (const field of LEGACY_FIELD_NAMES) expect(Object.keys(entry)).not.toContain(field)
    expect(entry).toMatchObject({
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

  it('flattens settings.routes onto the entry', () => {
    expect(
      parse(legacyEntry({ settings: { routes: ['/rigstream/settings'] } })).settingsRoutes,
    ).toEqual(['/rigstream/settings'])
  })

  it('marks a hidden legacy app hidden', () => {
    expect(parse(legacyEntry({ hidden: true })).hidden).toBe(true)
  })

  it('omits presentation fields the legacy entry did not carry', () => {
    const entry = parse(
      legacyEntry({ title: undefined, icon: undefined, version: undefined, hidden: undefined }),
    )

    expect('title' in entry).toBe(false)
    expect('icon' in entry).toBe(false)
    expect('version' in entry).toBe(false)
    expect('hidden' in entry).toBe(false)
  })

  it('substitutes empty collections for the legacy fields an entry omitted', () => {
    const entry = parse({
      name: 'rigstream',
      mfManifestUrl: 'https://cdn.example.test/rigstream/mf-manifest.json',
    })

    expect(entry).toMatchObject({
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
    expect(parse(legacyEntry()).navigationOwnership).toBe('shell')
  })

  it('preserves the legacy name as the container name the loader registers', () => {
    const entry = parse(legacyEntry({ name: 'AssetTracker' }))

    expect(entry.id).toBe('asset-tracker')
    expect(entry.containerName).toBe('AssetTracker')
  })
})

describe('is', () => {
  it('claims the entries it parsed and reaches their own fields without a cast', () => {
    const entry: RegistryEntry = parse(legacyEntry())

    expect(legacyAngularAdapter.is(entry)).toBe(true)
    if (legacyAngularAdapter.is(entry)) expect(entry.containerName).toBe('asset-tracker')
  })

  it('refuses an entry another adapter parsed', () => {
    const foreign: RegistryEntry = {
      id: 'reports',
      definitionKind: 'app',
      adapter: 'react',
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    }

    expect(legacyAngularAdapter.is(foreign)).toBe(false)
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

describe('parse failures', () => {
  it('names the missing app name and what it is used for', () => {
    const error = rejection(legacyEntry({ name: undefined }))

    expect(error).toMatchObject({ code: 'registry/invalid-entry', path: ['name'] })
    expect(error.message).toContain('Set the app name in the shell registry entry')
  })

  it('names the missing manifest URL', () => {
    expect(rejection(legacyEntry({ mfManifestUrl: '' }))).toMatchObject({
      code: 'registry/invalid-entry',
      path: ['mfManifestUrl'],
    })
  })

  it('rejects a name that cannot become a definition id', () => {
    const error = rejection(legacyEntry({ name: '///' }))

    expect(error.code).toBe('registry/invalid-entry')
    expect(error.message).toContain('lower-case letters, digits and single hyphens')
  })

  it('names the field and the expected shape when a legacy list is malformed', () => {
    const error = rejection(legacyEntry({ tags: ['assets', 7] }))

    expect(error).toMatchObject({ code: 'registry/invalid-entry', path: ['tags', 1] })
    expect(error.message).toContain('an array of strings, or nothing')
  })

  it('names settings.routes by its full path', () => {
    expect(rejection(legacyEntry({ settings: { routes: 'all' } }))).toMatchObject({
      path: ['settings', 'routes'],
    })
  })

  it('rejects a settings block that is not an object', () => {
    expect(rejection(legacyEntry({ settings: 'routes' })).message).toContain(
      'an object such as { routes: [] }, or nothing',
    )
  })

  it('rejects an entry that is not an object', () => {
    expect(rejection('asset-tracker').code).toBe('registry/invalid-entry')
  })
})

describe('the legacy adapter inside a shell that reads the registry', () => {
  /** Stands in for `reactAdapter`, which lives in a package this one may not import. */
  const frameworkAdapter: MfeAdapter = {
    kind: 'react',
    detect: raw => raw !== null && typeof raw === 'object' && 'mfe' in raw,
    parse: () => {
      throw new Error('the framework adapter is not exercised here')
    },
    is: (entry): entry is RegistryEntry => entry.adapter === 'react',
  }

  const adapters = [frameworkAdapter, legacyAngularAdapter]

  it('accepts a legacy entry the framework adapter does not recognise', () => {
    const registry = readRegistry([legacyEntry()], { adapters })

    expect(registry.rejected).toEqual([])
    expect(registry.entries.get('asset-tracker')?.adapter).toBe('legacy-angular')
  })

  it('leaves an entry carrying a malformed framework version to the framework adapter', () => {
    const source = legacyEntry({ mfe: { contractMajor: 'one' }, id: 'asset-tracker' })

    const registry = readRegistry([source], { adapters })

    expect(registry.entries.size).toBe(0)
    expect(registry.rejected).toHaveLength(1)
    expect(registry.rejected[0]?.reason).toBe('the react adapter rejected this entry')
  })

  it('keeps a valid legacy entry when a malformed one is rejected beside it', () => {
    const registry = readRegistry([legacyEntry({ mfe: {} }), legacyEntry({ name: 'rigstream' })], {
      adapters,
    })

    expect([...registry.entries.keys()]).toEqual(['rigstream'])
    expect(registry.rejected).toHaveLength(1)
  })

  it('rejects a legacy entry that no adapter recognises at all', () => {
    const registry = readRegistry([{ name: 'asset-tracker' }], { adapters })

    expect(registry.entries.size).toBe(0)
    expect(registry.rejected[0]?.reason).toBe('no adapter recognised this entry')
  })
})
