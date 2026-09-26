/**
 * The React adapter against the entries a framework build publishes: `detect` stays loose so a
 * broken React entry never falls to another adapter, and `parse` names the field that broke.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { isMfeError, type MfeError, type RegistryEntry } from '@company/mfe-core'

import { reactAdapter, type ReactRegistryEntry } from './react-adapter.ts'

/** A registry entry as the build plugin emits it for the current framework version. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'reports',
    kind: 'app',
    mfe: { contractMajor: 1, framework: 'react' },
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
  describe('recognises a React entry however malformed its version marker is', () => {
    const malformed: readonly (readonly [string, unknown])[] = [
      ['a contract major of the wrong type', { contractMajor: 'one', framework: 'react' }],
      ['an unsupported contract major', { contractMajor: 99, framework: 'react' }],
      ['no contract major', { framework: 'react' }],
    ]

    for (const [description, mfe] of malformed) {
      it(`still recognises an entry with ${description}`, () => {
        expect(reactAdapter.detect(entry({ mfe }))).toBe(true)
      })
    }
  })

  /** It is no adapter's, so the registry rejects it as unrecognised, which also fails loudly. */
  describe('does not recognise an entry whose marker names no framework', () => {
    const unnamed: readonly (readonly [string, unknown])[] = [
      ['a marker without a framework', { contractMajor: 1 }],
      ['an empty marker object', {}],
      ['a marker that is a string', 'v1'],
      ['a marker that is null', null],
      ['a marker that is an array', []],
    ]

    for (const [description, mfe] of unnamed) {
      it(`does not recognise an entry with ${description}`, () => {
        expect(reactAdapter.detect(entry({ mfe }))).toBe(false)
      })
    }
  })

  describe('the framework the entry names', () => {
    it('recognises an entry that names React', () => {
      expect(reactAdapter.detect(entry({ mfe: { contractMajor: 1, framework: 'react' } }))).toBe(
        true,
      )
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

/** The shape is the runtime's `parseFederatedEntry`, whose own tests cover every field. */
describe('parse', () => {
  it('reads the shared entry shape and stamps this adapter on it', () => {
    expect(parse(entry())).toEqual({
      id: 'reports',
      definitionKind: 'app',
      adapter: 'react',
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
      container: 'example_reports',
    })
  })

  it('names the field that broke and the one repair', () => {
    const error = rejection(entry({ container: '' }))

    expect(error.code).toBe('registry/invalid-entry')
    expect(error.path).toEqual(['container'])
    expect(error.message).toContain('Rebuild the container')
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
