/**
 * The views of the registry a host renders.
 *
 * What is worth asserting here is not that a filter filters. It is that the
 * answers agree: the finder, the catalogue, the settings list and the chrome
 * all asked the registry the same question separately before this existed, and
 * a shell where two of those disagree about a hidden entry, or about which
 * segment of the URL names the mounted application, has a bug nobody can see in
 * either surface alone.
 */

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import type { NeutralRegistryEntry } from '@company/mfe-core'

import { MfeProvider } from './runtime-context.tsx'
import {
  useActiveDefinition,
  useApps,
  useCapabilityPages,
  useRegistryEntries,
  useWidgets,
} from './registry-selectors.ts'
import { createMfeTestEnvironment, type MfeTestEnvironment } from './testing/index.tsx'
import type { MfeRuntime } from './runtime.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

function entry(overrides: Partial<NeutralRegistryEntry> & { id: string }): NeutralRegistryEntry {
  return {
    definitionKind: 'app',
    adapter: 'react',
    manifestUrl: `https://example.test/${overrides.id}/mf-manifest.json`,
    ...overrides,
  }
}

const OPERATIONS = entry({
  id: 'operations',
  title: 'Operations',
  capabilities: [
    { name: 'settings', label: 'Operations settings', path: '/settings' },
    { name: 'help', label: 'Operations help', path: '/help' },
  ],
})

const REPORTS = entry({
  id: 'reports',
  capabilities: [{ name: 'releaseNotes', label: 'What changed', path: '/changes' }],
})

const INTERNAL = entry({ id: 'internal-tools', hidden: true })

const ALERT_PANEL = entry({ id: 'alert-panel', definitionKind: 'widget' })

const HIDDEN_WIDGET = entry({ id: 'scratch-widget', definitionKind: 'widget', hidden: true })

const REGISTRY = [OPERATIONS, REPORTS, INTERNAL, ALERT_PANEL, HIDDEN_WIDGET]

/** A runtime whose registry is the fixture above; everything else is the real thing. */
function hosted(): (props: { readonly children: ReactNode }) => ReactNode {
  environment = createMfeTestEnvironment({ definitionId: 'shell' })
  const runtime: MfeRuntime = {
    ...environment.runtime,
    registry: {
      entries: new Map(REGISTRY.map(candidate => [candidate.id, candidate])),
      quarantined: [],
    },
  }

  return ({ children }) => <MfeProvider runtime={runtime}>{children}</MfeProvider>
}

describe('registry selectors', () => {
  it('lists every accepted entry, in registry order', () => {
    const { result } = renderHook(() => useRegistryEntries(), { wrapper: hosted() })

    expect(result.current.map(candidate => candidate.id)).toEqual([
      'operations',
      'reports',
      'internal-tools',
      'alert-panel',
      'scratch-widget',
    ])
  })

  it('offers the Apps, and neither a Widget nor an entry that opted out', () => {
    const { result } = renderHook(() => useApps(), { wrapper: hosted() })

    expect(result.current.map(candidate => candidate.id)).toEqual(['operations', 'reports'])
  })

  it('offers the Widgets, and neither an App nor an entry that opted out', () => {
    const { result } = renderHook(() => useWidgets(), { wrapper: hosted() })

    expect(result.current.map(candidate => candidate.id)).toEqual(['alert-panel'])
  })

  it('keeps the same array across renders, so a memoized consumer is not re-rendered', () => {
    const { result, rerender } = renderHook(() => useApps(), { wrapper: hosted() })
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })
})

describe('capability pages', () => {
  it('flattens every page with the App that published it', () => {
    const { result } = renderHook(() => useCapabilityPages(), { wrapper: hosted() })

    expect(result.current.map(page => `${page.app.id}:${page.capability.name}`)).toEqual([
      'operations:settings',
      'operations:help',
      'reports:releaseNotes',
    ])
  })

  /**
   * The bug this exists for. A host lists these under a heading naming one
   * capability — "Application settings" — and without the filter it listed
   * every application's help and release-notes pages there too, with nothing
   * but the heading to say they were not settings.
   */
  it('lists only the named capability', () => {
    const { result } = renderHook(() => useCapabilityPages('settings'), { wrapper: hosted() })

    expect(result.current.map(page => page.capability.label)).toEqual(['Operations settings'])
  })

  it('is empty rather than absent when no App publishes the named capability', () => {
    const { result } = renderHook(() => useCapabilityPages('help'), { wrapper: hosted() })

    expect(result.current.map(page => page.app.id)).toEqual(['operations'])
  })
})

describe('the active definition', () => {
  it('is null on a page the host owns', () => {
    const { result } = renderHook(() => useActiveDefinition('/'), { wrapper: hosted() })

    expect(result.current).toBeNull()
  })

  it('names the App a deep route belongs to, with its entry', () => {
    const { result } = renderHook(() => useActiveDefinition('/operations/wells/reduced-dls'), {
      wrapper: hosted(),
    })

    expect(result.current?.id).toBe('operations')
    expect(result.current?.entry?.title).toBe('Operations')
  })

  /** Hidden excludes an entry from listings. It is not a second kind of unknown. */
  it('names a hidden App that was navigated to directly', () => {
    const { result } = renderHook(() => useActiveDefinition('/internal-tools'), {
      wrapper: hosted(),
    })

    expect(result.current).toEqual({ id: 'internal-tools', entry: INTERNAL })
  })

  it('names an id the registry does not know, with no entry', () => {
    const { result } = renderHook(() => useActiveDefinition('/never-deployed'), {
      wrapper: hosted(),
    })

    expect(result.current).toEqual({ id: 'never-deployed', entry: undefined })
  })

  /** A Widget is mounted in a page, never at a boundary, so the URL is wrong. */
  it('does not present a Widget as the App at the boundary', () => {
    const { result } = renderHook(() => useActiveDefinition('/alert-panel'), { wrapper: hosted() })

    expect(result.current).toEqual({ id: 'alert-panel', entry: undefined })
  })
})
