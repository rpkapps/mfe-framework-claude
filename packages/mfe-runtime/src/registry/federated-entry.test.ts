/**
 * The entry shape every framework build publishes, read once for every adapter: identity and
 * container, the contract major gated before the shape, a Widget's published contract, an App's
 * capabilities, and the presentation fields a host may drop rather than reject an entry over.
 */

import { describe, expect, it } from 'vitest'

import { isMfeError, type MfeError } from '@company/mfe-core'

import { createFederatedAdapter, parseFederatedEntry } from './federated-entry.ts'

/** Any adapter's name will do; the parser stamps whichever it is given. */
const ADAPTER = 'test-adapter'

/** A registry entry as a framework build emits it. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'reports',
    kind: 'app',
    mfe: { contractMajor: 1 },
    manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    container: 'example_reports',
    ...overrides,
  }
}

function parse(source: Record<string, unknown>) {
  return parseFederatedEntry(source, ADAPTER)
}

function rejection(source: unknown): MfeError {
  try {
    parseFederatedEntry(source, ADAPTER)
  } catch (error) {
    if (isMfeError(error)) return error
    throw error
  }
  throw new Error('expected the parser to reject the entry')
}

describe('parse', () => {
  it('reads identity, kind, manifest URL and container name', () => {
    expect(parse(entry())).toMatchObject({
      id: 'reports',
      definitionKind: 'app',
      adapter: ADAPTER,
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
      container: 'example_reports',
    })
  })

  it('leaves the expose path absent when the build named none', () => {
    expect('expose' in parse(entry())).toBe(false)
  })

  it('rejects an entry with no id', () => {
    expect(rejection(entry({ id: undefined })).message).toContain('a non-empty definition id')
  })

  it('rejects an entry with no manifest URL', () => {
    expect(rejection(entry({ manifestUrl: undefined })).path).toEqual(['manifestUrl'])
  })

  it('rejects an entry with no container name', () => {
    expect(rejection(entry({ container: '' })).message).toContain(
      'a non-empty federation container name',
    )
  })

  it('rejects an entry whose kind is neither app nor widget', () => {
    expect(rejection(entry({ kind: 'page' })).message).toContain('"app" or "widget"')
  })

  it('rejects a version marker that is not an object', () => {
    expect(rejection(entry({ mfe: true })).message).toContain('{ "contractMajor": 1 }')
  })

  it('rejects a contract major that is not an integer', () => {
    expect(rejection(entry({ mfe: { contractMajor: 'one' } })).message).toContain('an integer')
  })

  it('rejects a value that is not an object at all', () => {
    expect(rejection('reports').code).toBe('registry/invalid-entry')
  })

  it('codes every shape failure as an invalid entry and says the entry is generated', () => {
    const error = rejection(entry({ kind: 'page' }))

    expect(error.code).toBe('registry/invalid-entry')
    expect(error.message).toContain('the registry entry is generated, never hand-written')
  })
})

describe('share scopes', () => {
  it('carries the share scopes the build published through to the entry', () => {
    expect(parse(entry({ shareScopes: ['default', 'react@19.3.0'] })).shareScopes).toEqual([
      'default',
      'react@19.3.0',
    ])
  })

  it('leaves them absent for an entry built before framework scopes', () => {
    expect('shareScopes' in parse(entry())).toBe(false)
  })

  it('rejects share scopes that are not a list of names', () => {
    expect(rejection(entry({ shareScopes: 'react@19.3.0' })).message).toContain(
      'an array of share scope names',
    )
    expect(rejection(entry({ shareScopes: ['default', ''] })).path).toEqual(['shareScopes', 1])
  })
})

describe('the framework version the container was built for', () => {
  it('reports an unsupported major rather than quietly skipping the entry', () => {
    const error = rejection(entry({ mfe: { contractMajor: 2 } }))

    expect(error.code).toBe('contract/unsupported-major')
    expect(error.message).toContain('Upgrade the shell')
  })

  it('tells a container built against an older major to rebuild', () => {
    const error = rejection(entry({ mfe: { contractMajor: 0 } }))

    expect(error.code).toBe('contract/unsupported-major')
    expect(error.message).toContain('Rebuild and redeploy the container')
  })
})

/**
 * A host renders a Widget catalogue before it fetches anything, so what a Widget takes travels
 * in the registry.
 */
describe('published Widget contract', () => {
  const contract = {
    inputSchema: {
      type: 'object',
      properties: { alertId: { type: 'string' }, severity: { enum: ['info', 'critical'] } },
      required: ['alertId'],
      additionalProperties: false,
    },
    outputSchema: {
      title: 'alert-panel outputs',
      type: 'object',
      properties: {
        acknowledged: {
          type: 'object',
          properties: { alertId: { type: 'string' } },
          required: ['alertId'],
          additionalProperties: false,
        },
        dismissed: {},
      },
      additionalProperties: false,
    },
  }

  it('carries the inputSchema and the outputSchema through to the entry', () => {
    const parsed = parse(entry({ id: 'alert-panel', kind: 'widget', contract }))

    expect(parsed.contract).toEqual(contract)
  })

  /**
   * "Takes nothing" and "the build could not read the schema" call for different behaviour in a
   * catalogue, so an unread schema is absent rather than empty.
   */
  it('accepts a contract that publishes an outputSchema without an inputSchema', () => {
    const parsed = parse(
      entry({
        id: 'alert-panel',
        kind: 'widget',
        contract: { outputSchema: contract.outputSchema },
      }),
    )

    expect(parsed.contract).toEqual({ outputSchema: contract.outputSchema })
    expect(parsed.contract && 'inputSchema' in parsed.contract).toBe(false)
  })

  it('accepts a contract that publishes neither schema', () => {
    const parsed = parse(entry({ id: 'alert-panel', kind: 'widget', contract: {} }))

    expect(parsed.contract).toEqual({})
  })

  it('rejects a Widget contract on an App', () => {
    expect(rejection(entry({ contract })).message).toContain('An App has no inputs and no outputs')
  })

  it('rejects an outputSchema that is not a schema', () => {
    for (const outputSchema of [['acknowledged'], 'acknowledged']) {
      expect(
        rejection(entry({ id: 'alert-panel', kind: 'widget', contract: { outputSchema } })).message,
      ).toContain('a JSON Schema object, or nothing when the build could not read one')
    }
  })

  it('rejects a contract that is not an object', () => {
    expect(
      rejection(entry({ id: 'alert-panel', kind: 'widget', contract: 'acknowledged' })).code,
    ).toBe('registry/invalid-entry')
  })
})

describe('routes', () => {
  it('carries an App’s routes, with their search params, through to the entry', () => {
    const search = { type: 'object', properties: { site: { type: 'string' } } }
    const parsed = parse(entry({ routes: [{ path: '/' }, { path: '/wells/:wellId', search }] }))

    expect(parsed.routes).toEqual([{ path: '/' }, { path: '/wells/:wellId', search }])
  })

  it('rejects a Widget that publishes routes, since it owns no URL', () => {
    const error = rejection(entry({ id: 'alert-panel', kind: 'widget', routes: [{ path: '/' }] }))

    expect(error.message).toContain('no routes on a Widget')
  })

  it('rejects a path that is not App-relative', () => {
    expect(rejection(entry({ routes: [{ path: 'wells' }] })).message).toContain(
      'an App-relative path starting with /',
    )
  })
})

describe('capabilities', () => {
  it('carries App capabilities through to the entry', () => {
    const parsed = parse(
      entry({
        capabilities: [
          { name: 'settings', label: 'Report settings', path: '/settings' },
          { name: 'help', label: 'Help', path: '/help', icon: 'question-mark' },
          { name: 'releaseNotes', label: 'What is new', path: '/news', icon: { src: '/n.svg' } },
        ],
      }),
    )

    expect(parsed.capabilities).toEqual([
      { name: 'settings', label: 'Report settings', path: '/settings' },
      { name: 'help', label: 'Help', path: '/help', icon: 'question-mark' },
      { name: 'releaseNotes', label: 'What is new', path: '/news', icon: { src: '/n.svg' } },
    ])
  })

  it('rejects a Widget that declares capabilities', () => {
    const error = rejection(
      entry({
        id: 'alert-panel',
        kind: 'widget',
        capabilities: [{ name: 'settings', label: 'Settings', path: '/settings' }],
      }),
    )

    expect(error.message).toContain('no capabilities on a Widget')
    expect(error.message).toContain('Move the capability routes into an App')
  })

  it('rejects a Widget that declares an empty capability list', () => {
    expect(rejection(entry({ id: 'alert-panel', kind: 'widget', capabilities: [] })).code).toBe(
      'registry/invalid-entry',
    )
  })

  it('drops a capability this shell has no surface for, and keeps the App and its other pages', () => {
    const parsed = parse(
      entry({
        capabilities: [
          { name: 'settings', label: 'Report settings', path: '/settings' },
          { name: 'billing', label: 'Billing', path: '/billing' },
        ],
      }),
    )

    expect(parsed.capabilities).toEqual([
      { name: 'settings', label: 'Report settings', path: '/settings' },
    ])
  })

  it('rejects a capability whose name is not a string', () => {
    expect(
      rejection(entry({ capabilities: [{ name: 7, label: 'Billing', path: '/b' }] })).message,
    ).toContain('a capability name string')
  })

  it('rejects an icon that is neither a shell icon name nor an asset reference', () => {
    expect(
      rejection(
        entry({
          capabilities: [{ name: 'help', label: 'Help', path: '/h', icon: { svg: '<svg/>' } }],
        }),
      ).message,
    ).toContain('an icon name from the shell icon set')
  })

  it('rejects capabilities that are not an array', () => {
    expect(rejection(entry({ capabilities: 'settings' })).message).toContain(
      'an array of capability objects',
    )
  })
})

describe('optional fields', () => {
  it('carries version, title, icon and hidden through, and omits what was absent', () => {
    const parsed = parse(entry({ version: '2.1.0', title: 'Reports', icon: 'chart', hidden: true }))

    expect(parsed).toMatchObject({
      version: '2.1.0',
      title: 'Reports',
      icon: 'chart',
      hidden: true,
    })

    const bare = parse(entry({ id: 'billing' }))
    expect(bare.version).toBeUndefined()
    expect(bare.title).toBeUndefined()
    expect(bare.hidden).toBeUndefined()
  })

  it('treats hidden as an opt-in flag rather than any truthy value', () => {
    expect(parse(entry({ hidden: 'yes' })).hidden).toBeUndefined()
  })

  it('keeps the tags a host can read and drops the rest', () => {
    expect(parse(entry({ tags: ['ops', 7, '', 'field'] })).tags).toEqual(['ops', 'field'])
  })

  it('treats tags it cannot read at all as no tags', () => {
    expect(parse(entry({ tags: 'ops' })).tags).toBeUndefined()
    expect(parse(entry({ tags: [7] })).tags).toBeUndefined()
  })

  it('carries a parsed icon through and drops one it cannot read', () => {
    const parsed = parse(
      entry({ icon: { viewBox: '0 0 24 24', node: [['path', { d: 'M0 0h24v24H0z' }]] } }),
    )

    expect(parsed.icon).toEqual({
      viewBox: '0 0 24 24',
      node: [['path', { d: 'M0 0h24v24H0z' }]],
    })
    expect(parse(entry({ icon: { svg: '<svg/>' } })).icon).toBeUndefined()
  })
})

/**
 * The build is validated exactly as loosely as it is trusted: never gating the entry, never
 * passed on as something it is not.
 */
describe('build provenance', () => {
  it('carries the hash and the time through to the entry', () => {
    const parsed = parse(
      entry({ build: { hash: '1e485caec528f7fa', time: '2026-09-20T19:10:41.398Z' } }),
    )

    expect(parsed.build).toEqual({
      hash: '1e485caec528f7fa',
      time: '2026-09-20T19:10:41.398Z',
    })
  })

  it('carries a half-published build rather than losing the half that is there', () => {
    expect(parse(entry({ build: { hash: '1e485caec528f7fa' } })).build).toEqual({
      hash: '1e485caec528f7fa',
    })
  })

  it('accepts an entry that names no build at all', () => {
    expect(parse(entry()).build).toBeUndefined()
  })

  it('drops a build it cannot read instead of failing the entry over it', () => {
    expect(parse(entry({ build: 'yesterday' })).build).toBeUndefined()
    expect(parse(entry({ build: { hash: 42 } })).build).toBeUndefined()
  })
})

describe('an adapter for one framework’s federation builds', () => {
  const marked = (mfe: unknown): Record<string, unknown> => entry({ mfe })

  it('claims exactly the entries whose marker names its framework, however broken they are', () => {
    const adapter = createFederatedAdapter({ kind: 'plain-dom' })

    expect(adapter.detect(marked({ contractMajor: 1, framework: 'plain-dom' }))).toBe(true)
    expect(adapter.detect(marked({ contractMajor: 'one', framework: 'plain-dom' }))).toBe(true)
    expect(adapter.detect(marked({ contractMajor: 1, framework: 'react' }))).toBe(false)
    expect(adapter.detect(marked({ contractMajor: 1 }))).toBe(false)
    expect(adapter.detect(marked('broken'))).toBe(false)
    expect(adapter.detect(entry({ mfe: undefined }))).toBe(false)
    expect(adapter.detect('not an entry')).toBe(false)
  })

  it('also claims an entry that names no framework, when asked to', () => {
    const adapter = createFederatedAdapter({ kind: 'react', claimsUnmarked: true })

    expect(adapter.detect(marked({ contractMajor: 1 }))).toBe(true)
    expect(adapter.detect(marked('broken'))).toBe(true)
    expect(adapter.detect(marked({ contractMajor: 1, framework: 'angular' }))).toBe(false)
    expect(adapter.detect({ id: 'reports' })).toBe(false)
  })

  it('parses through the shared reading, stamps its kind, and recognises only its own', () => {
    const adapter = createFederatedAdapter({ kind: 'plain-dom' })
    const parsed = adapter.parse(marked({ contractMajor: 1, framework: 'plain-dom' }))

    expect(parsed.adapter).toBe('plain-dom')
    expect(adapter.is(parsed)).toBe(true)
    expect(adapter.is({ ...parsed, adapter: 'react' })).toBe(false)
    expect(() => adapter.parse(marked({ contractMajor: 'one', framework: 'plain-dom' }))).toThrow(
      /reports failed to read registry entry mfe\.contractMajor/,
    )
  })

  it('wraps loads only when given a hook', () => {
    const aroundLoad = <T>(load: () => Promise<T>): Promise<T> => load()

    expect(createFederatedAdapter({ kind: 'plain-dom' }).aroundLoad).toBeUndefined()
    expect(createFederatedAdapter({ kind: 'plain-dom', aroundLoad }).aroundLoad).toBe(aroundLoad)
  })
})
