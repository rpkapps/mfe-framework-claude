/**
 * What `createMfeRuntime` registers: `reactAdapter` always, plus whatever the shell passes in
 * `adapters`. Order means nothing — exactly one adapter has to recognise each entry.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createNoopTelemetryProvider } from '@company/mfe-host'
import { createInProcessLoader } from '@company/mfe-host/testing'
import type { MfeAdapter, RegistryEntry } from '@company/mfe-core'

import { createMfeRuntime, createMount, type MfeRuntimeHandle } from './create-runtime.ts'

let handle: MfeRuntimeHandle | null = null

afterEach(() => {
  const current = handle
  handle = null
  current?.dispose()
})

/** An entry from before the framework existed: no `mfe` key, its own manifest field. */
const LEGACY_ENTRY = {
  id: 'billing',
  mfManifestUrl: 'https://cdn.example.test/billing/manifest.json',
  routes: ['/billing'],
}

/** A framework entry, so one wiring can hold both kinds. */
const FRAMEWORK_ENTRY = {
  id: 'reports',
  kind: 'app',
  mfe: { contractMajor: 1 },
  manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
  container: 'example_reports',
}

/** Stands in for `legacyAngularAdapter`, which lives in a package this one may not import. */
const legacyAdapter: MfeAdapter = {
  kind: 'legacy-angular',
  detect: raw =>
    raw !== null &&
    typeof raw === 'object' &&
    !('mfe' in raw) &&
    typeof (raw as Record<string, unknown>)['mfManifestUrl'] === 'string',
  parse: (raw): RegistryEntry => ({
    id: (raw as Record<string, string>)['id'] ?? '',
    definitionKind: 'app',
    adapter: 'legacy-angular',
    manifestUrl: (raw as Record<string, string>)['mfManifestUrl'] ?? '',
  }),
  is: (entry): entry is RegistryEntry => entry.adapter === 'legacy-angular',
}

function wire(options: {
  readonly entries?: readonly unknown[]
  readonly adapters?: readonly MfeAdapter[]
}): MfeRuntimeHandle {
  handle = createMfeRuntime({
    registryEntries: options.entries ?? [LEGACY_ENTRY],
    loader: createInProcessLoader(new Map()),
    shellState: { user: null, groups: [], theme: 'dark' },
    telemetryProvider: createNoopTelemetryProvider(),
    sessionGeneration: 'gen-1',
    overrideStorage: { getItem: () => null },
    ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
  })
  return handle
}

it('reads a framework entry through the adapter it always registers', () => {
  const { runtime } = wire({ entries: [FRAMEWORK_ENTRY] })

  expect(runtime.registry.rejected).toEqual([])
  expect(runtime.registry.entries.get('reports')?.adapter).toBe('react')
})

it('rejects an entry no registered adapter recognises', () => {
  const { runtime } = wire({})

  expect(runtime.registry.entries.has('billing')).toBe(false)
  expect(runtime.registry.rejected.map(entry => entry.id)).toEqual(['billing'])
  expect(runtime.registry.rejected[0]?.reason).toBe('no adapter recognised this entry')
})

it('accepts that entry through an adapter the caller adds', () => {
  const { runtime } = wire({ adapters: [legacyAdapter] })

  expect(runtime.registry.rejected).toEqual([])
  expect(runtime.registry.entries.get('billing')?.adapter).toBe('legacy-angular')
})

it('keeps the React adapter registered alongside the ones the caller adds', () => {
  const { runtime } = wire({
    entries: [FRAMEWORK_ENTRY, LEGACY_ENTRY],
    adapters: [legacyAdapter],
  })

  expect(runtime.registry.rejected).toEqual([])
  expect([...runtime.registry.entries.keys()].sort()).toEqual(['billing', 'reports'])
})

/** Stands in for `angularAdapter`, which lives in a package this one may not import. */
const angularAdapter: MfeAdapter = {
  kind: 'angular',
  detect: raw =>
    raw !== null &&
    typeof raw === 'object' &&
    (raw as { mfe?: { framework?: unknown } }).mfe?.framework === 'angular',
  parse: (raw): RegistryEntry => ({
    id: (raw as Record<string, string>)['id'] ?? '',
    definitionKind: 'widget',
    adapter: 'angular',
    manifestUrl: (raw as Record<string, string>)['manifestUrl'] ?? '',
  }),
  is: (entry): entry is RegistryEntry => entry.adapter === 'angular',
}

/** An Angular build's entry differs from a React one only in the framework it names. */
const ANGULAR_ENTRY = {
  ...FRAMEWORK_ENTRY,
  id: 'alert-panel',
  kind: 'widget',
  mfe: { contractMajor: 1, framework: 'angular' },
}

it('leaves an entry another framework built to that framework’s adapter', () => {
  const { runtime } = wire({ entries: [ANGULAR_ENTRY], adapters: [angularAdapter] })

  expect(runtime.registry.rejected).toEqual([])
  expect(runtime.registry.entries.get('alert-panel')?.adapter).toBe('angular')
})

it('rejects an entry another framework built when that adapter is not registered', () => {
  const { runtime } = wire({ entries: [FRAMEWORK_ENTRY, ANGULAR_ENTRY] })

  expect([...runtime.registry.entries.keys()]).toEqual(['reports'])
  expect(runtime.registry.rejected.map(entry => entry.id)).toEqual(['alert-panel'])
})

describe('createMount', () => {
  it('gives every mount its own Query client', async () => {
    const { runtime } = wire({ entries: [FRAMEWORK_ENTRY] })

    const first = createMount({ runtime, definitionId: 'reports', kind: 'app' })
    const second = createMount({ runtime, definitionId: 'reports', kind: 'app' })

    expect(first.mount.queryClient).not.toBe(second.mount.queryClient)
    await first.dispose()
    await second.dispose()
  })

  it('aborts the mount, clears its Query client and removes its overlay root when disposed', async () => {
    const { runtime } = wire({ entries: [FRAMEWORK_ENTRY] })
    const mounted = createMount({ runtime, definitionId: 'reports', kind: 'app' })
    mounted.mount.queryClient.setQueryData(['accounts'], ['a-1'])

    await mounted.dispose()

    expect(mounted.mount.signal.aborted).toBe(true)
    expect(mounted.mount.queryClient.getQueryData(['accounts'])).toBeUndefined()
    expect(mounted.mount.overlayRoot.isConnected).toBe(false)
  })

  /** Anything listening for the abort must find the mount already gone from the palette. */
  it('removes the mount’s commands before its Query client is cleared', async () => {
    const { runtime } = wire({ entries: [FRAMEWORK_ENTRY] })
    const mounted = createMount({ runtime, definitionId: 'reports', kind: 'app' })
    runtime.commands.register('reports', mounted.mount.mountToken, {
      name: 'refresh',
      label: 'Refresh',
      execute: () => undefined,
    })
    let commandsWhenCleared: number | undefined
    mounted.mount.queryClient.getQueryCache().subscribe(event => {
      if (event.type === 'removed') commandsWhenCleared = runtime.commands.getSnapshot().length
    })
    mounted.mount.queryClient.setQueryData(['accounts'], ['a-1'])

    await mounted.dispose()

    expect(commandsWhenCleared).toBe(0)
  })
})
