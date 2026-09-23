/**
 * The Angular adapter against the entries an Angular container's build publishes: it recognises
 * exactly the entries naming Angular, however broken the rest is, and `parse` is strict.
 */

import { isMfeError, type MfeError, type RegistryEntry } from '@company/mfe-core'
import { describe, expect, it } from 'vitest'

import { angularAdapter, type AngularRegistryEntry } from './angular-adapter.ts'

/** A registry entry as the build plugin emits it for an Angular container. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'reports',
    kind: 'app',
    mfe: { contractMajor: 1, framework: 'angular' },
    manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
    container: 'example_reports',
    ...overrides,
  }
}

function rejection(source: unknown): MfeError {
  try {
    angularAdapter.parse(source)
  } catch (error) {
    if (isMfeError(error)) return error
    throw error
  }
  throw new Error('expected the adapter to reject the entry')
}

describe('detect', () => {
  it('recognises an entry whose marker names Angular, however broken the rest of it is', () => {
    expect(angularAdapter.detect(entry())).toBe(true)
    expect(angularAdapter.detect(entry({ container: 7, mfe: { framework: 'angular' } }))).toBe(true)
  })

  it('leaves an entry naming another framework, or no framework at all, to another adapter', () => {
    expect(angularAdapter.detect(entry({ mfe: { contractMajor: 1, framework: 'other' } }))).toBe(
      false,
    )
    expect(angularAdapter.detect(entry({ mfe: { contractMajor: 1 } }))).toBe(false)
    expect(angularAdapter.detect(entry({ mfe: 'angular' }))).toBe(false)
  })

  it('is total over input that is not an entry at all', () => {
    for (const raw of [null, undefined, 'reports', 7, []]) {
      expect(angularAdapter.detect(raw)).toBe(false)
    }
  })
})

describe('parse', () => {
  it('reads an App entry, stamping this adapter on it', () => {
    const parsed = angularAdapter.parse(entry({ version: '1.2.0', expose: './app' }))

    expect(parsed).toEqual({
      id: 'reports',
      definitionKind: 'app',
      adapter: 'angular',
      manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
      container: 'example_reports',
      expose: './app',
      version: '1.2.0',
    })
  })

  it('reads a Widget’s published contract, capabilities and presentation', () => {
    const widget = angularAdapter.parse(
      entry({
        id: 'alert-panel',
        kind: 'widget',
        contract: { events: ['acknowledged'], inputs: { type: 'object' } },
        title: 'Alert panel',
        tags: ['ops', 3, ''],
        icon: 'AP',
        hidden: true,
        build: { hash: 'abc123', time: { at: 'noon' } },
      }),
    )
    const app = angularAdapter.parse(
      entry({ capabilities: [{ name: 'settings', label: 'Settings', path: '/settings' }] }),
    )

    expect(widget).toMatchObject({
      definitionKind: 'widget',
      contract: { events: ['acknowledged'], inputs: { type: 'object' } },
      title: 'Alert panel',
      tags: ['ops'],
      icon: 'AP',
      hidden: true,
      build: { hash: 'abc123' },
    })
    expect(app.capabilities).toEqual([{ name: 'settings', label: 'Settings', path: '/settings' }])
  })

  it('names the field that broke and the one repair', () => {
    const error = rejection(entry({ container: '' }))

    expect(error.code).toBe('registry/invalid-entry')
    expect(error.path).toEqual(['container'])
    expect(error.message).toContain('a non-empty federation container name')
    expect(error.message).toContain('Rebuild the container')
  })

  it('refuses a Widget contract on an App', () => {
    expect(rejection(entry({ contract: { events: [] } })).message).toContain(
      'no Widget contract on an App',
    )
  })

  it('gates a contract major the shell cannot load before reading the shape', () => {
    const error = rejection(
      entry({ mfe: { contractMajor: 2, framework: 'angular' }, container: 1 }),
    )

    expect(error.code).toBe('contract/unsupported-major')
    expect(error.message).toContain('Upgrade the shell')
  })
})

describe('is', () => {
  it('narrows only the entries this adapter parsed', () => {
    const parsed: RegistryEntry = angularAdapter.parse(entry())
    const other: RegistryEntry = { ...parsed, adapter: 'other' }

    expect(angularAdapter.is(parsed)).toBe(true)
    expect(angularAdapter.is(other)).toBe(false)
    if (angularAdapter.is(parsed)) {
      const narrowed: AngularRegistryEntry = parsed
      expect(narrowed.container).toBe('example_reports')
    }
  })
})
