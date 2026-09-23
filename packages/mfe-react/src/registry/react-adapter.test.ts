/**
 * The React adapter against the entries a framework build publishes: `detect` stays loose so a
 * broken framework entry never falls to another adapter, and `parse` names the field that broke.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { isMfeError, type MfeError, type RegistryEntry } from '@company/mfe-core'

import { reactAdapter, type ReactRegistryEntry } from './react-adapter.ts'

/** A registry entry as the build plugin emits it for the current framework version. */
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

function parse(source: Record<string, unknown>): ReactRegistryEntry {
  return reactAdapter.parse(source)
}

function rejection(source: unknown): MfeError {
  try {
    reactAdapter.parse(source)
  } catch (error) {
    if (isMfeError(error)) return error
    throw error
  }
  throw new Error('expected the adapter to reject the entry')
}

describe('detect', () => {
  it('recognises an entry that carries a framework version', () => {
    expect(reactAdapter.detect(entry())).toBe(true)
  })

  /** A typo in framework metadata must fail rather than quietly change how an app loads (§9). */
  describe('recognises a framework entry however malformed its version marker is', () => {
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
      it(`still recognises an entry with ${description}`, () => {
        expect(reactAdapter.detect(entry({ mfe }))).toBe(true)
      })
    }
  })

  describe('the framework the entry names', () => {
    it('recognises an entry that names React', () => {
      expect(reactAdapter.detect(entry({ mfe: { contractMajor: 1, framework: 'react' } }))).toBe(
        true,
      )
    })

    /** Every React build before the field existed published exactly this marker. */
    it('recognises an entry that names no framework at all', () => {
      expect(reactAdapter.detect(entry({ mfe: { contractMajor: 1 } }))).toBe(true)
    })

    /** That entry belongs to its own adapter; reading it here would make both claim it. */
    it('does not recognise an entry that names Angular', () => {
      expect(reactAdapter.detect(entry({ mfe: { contractMajor: 1, framework: 'angular' } }))).toBe(
        false,
      )
    })

    it('does not recognise an entry that names a framework it does not know', () => {
      expect(reactAdapter.detect(entry({ mfe: { contractMajor: 1, framework: 'vue' } }))).toBe(
        false,
      )
    })

    it('reads an entry that names React exactly like one that names nothing', () => {
      const named = parse(entry({ mfe: { contractMajor: 1, framework: 'react' } }))

      expect(named).toEqual(parse(entry()))
    })
  })

  it('does not recognise an entry without a framework version', () => {
    expect(reactAdapter.detect({ name: 'billing', mfManifestUrl: '/b.json' })).toBe(false)
  })

  it('does not recognise values that are not registry objects', () => {
    expect(reactAdapter.detect(null)).toBe(false)
    expect(reactAdapter.detect('reports')).toBe(false)
    expect(reactAdapter.detect([entry()])).toBe(false)
    expect(reactAdapter.detect(42)).toBe(false)
  })
})

describe('is', () => {
  it('claims the entries it parsed and reaches their own fields without a cast', () => {
    const parsed: RegistryEntry = parse(entry({ expose: './app' }))

    expect(reactAdapter.is(parsed)).toBe(true)
    if (reactAdapter.is(parsed)) {
      expect(parsed.container).toBe('example_reports')
      expect(parsed.expose).toBe('./app')
    }
  })

  it('refuses an entry another adapter parsed', () => {
    const foreign: RegistryEntry = {
      id: 'asset-tracker',
      definitionKind: 'app',
      adapter: 'legacy-angular',
      manifestUrl: 'https://cdn.example.test/asset-tracker/mf-manifest.json',
    }

    expect(reactAdapter.is(foreign)).toBe(false)
  })
})

describe('parse', () => {
  it('reads identity, kind, manifest URL and container name', () => {
    expect(parse(entry())).toMatchObject({
      id: 'reports',
      definitionKind: 'app',
      adapter: 'react',
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
 * in the registry (§16).
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

  it('carries the inputs schema and event names through to the entry', () => {
    const parsed = parse(entry({ id: 'alert-panel', kind: 'widget', contract }))

    expect(parsed.contract).toEqual(contract)
  })

  /**
   * "Takes nothing" and "the build could not read the schema" call for different behaviour in a
   * catalogue, so an unread schema is absent rather than empty.
   */
  it('accepts a contract that publishes events without an inputs schema', () => {
    const parsed = parse(
      entry({ id: 'alert-panel', kind: 'widget', contract: { events: ['dismissed'] } }),
    )

    expect(parsed.contract).toEqual({ events: ['dismissed'] })
    expect(parsed.contract && 'inputs' in parsed.contract).toBe(false)
  })

  it('rejects a Widget contract on an App', () => {
    expect(rejection(entry({ contract })).message).toContain('An App has no inputs and no events')
  })

  it('rejects a contract whose events are not names', () => {
    expect(
      rejection(entry({ id: 'alert-panel', kind: 'widget', contract: { events: [{}] } })).message,
    ).toContain('an array of event names')
  })

  it('rejects a contract that is not an object', () => {
    expect(
      rejection(entry({ id: 'alert-panel', kind: 'widget', contract: 'acknowledged' })).code,
    ).toBe('registry/invalid-entry')
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

  it('rejects a capability name outside the closed set', () => {
    expect(
      rejection(entry({ capabilities: [{ name: 'billing', label: 'Billing', path: '/b' }] }))
        .message,
    ).toContain('settings, help, releaseNotes')
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
 * passed on as something it is not (§29).
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

/** The router plugin's development HMR shim reads this global while a container evaluates. */
describe('aroundLoad: the router global while a container evaluates', () => {
  const owner = globalThis as { __TSR_ROUTER__?: unknown }
  const parsed = (): ReactRegistryEntry => parse(entry())

  /** The adapter declares the hook, so a test reaching it without one fails loudly. */
  function aroundLoad<T>(load: () => Promise<T>): Promise<T> {
    if (reactAdapter.aroundLoad === undefined) throw new Error('expected a load hook')
    return reactAdapter.aroundLoad(load, parsed())
  }

  afterEach(() => {
    delete owner.__TSR_ROUTER__
  })

  it('is hidden during the evaluation and restored afterwards', async () => {
    const shellRouter = { id: 'shell' }
    owner.__TSR_ROUTER__ = shellRouter
    let seenDuringLoad: boolean | undefined

    const loaded = await aroundLoad(() => {
      seenDuringLoad = '__TSR_ROUTER__' in owner
      return Promise.resolve('module')
    })

    expect(loaded).toBe('module')
    expect(seenDuringLoad).toBe(false)
    expect(owner.__TSR_ROUTER__).toBe(shellRouter)
  })

  it('is restored after an evaluation that failed', async () => {
    const shellRouter = { id: 'shell' }
    owner.__TSR_ROUTER__ = shellRouter

    await expect(
      aroundLoad(() => Promise.reject(new Error('Loading chunk 42 failed'))),
    ).rejects.toThrow('Loading chunk 42 failed')

    expect(owner.__TSR_ROUTER__).toBe(shellRouter)
  })

  /** Restoring the old one would resurrect a router nothing uses any more. */
  it('keeps a router published during the evaluation rather than restoring the old one', async () => {
    owner.__TSR_ROUTER__ = { id: 'shell' }
    const published = { id: 'published during the load' }

    await aroundLoad(() => {
      owner.__TSR_ROUTER__ = published
      return Promise.resolve('module')
    })

    expect(owner.__TSR_ROUTER__).toBe(published)
  })

  it('is not created when the page had none', async () => {
    await aroundLoad(() => Promise.resolve('module'))

    expect('__TSR_ROUTER__' in owner).toBe(false)
  })
})
