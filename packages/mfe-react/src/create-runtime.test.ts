/**
 * The shell's selection table: the framework contract rule owns every entry that advertises the
 * contract, and a host that ships a second adapter registers its rule behind it.
 */

import { afterEach, expect, it } from 'vitest'
import { createNoopTelemetryProvider } from '@company/mfe-host'
import { createInProcessLoader } from '@company/mfe-host/testing'
import type { AdapterSelectionRule, NeutralRegistryEntry } from '@company/mfe-core'

import { createMfeRuntime, type MfeRuntimeHandle } from './create-runtime.ts'

let handle: MfeRuntimeHandle | null = null

afterEach(() => {
  const current = handle
  handle = null
  current?.dispose()
})

/** A descriptor from before the framework contract: no `mfe` key, its own manifest field. */
const LEGACY_ENTRY = {
  id: 'billing',
  mfManifestUrl: 'https://cdn.example.test/billing/manifest.json',
  routes: ['/billing'],
}

/** Stands in for `createLegacyAdapterRule()`, which lives in a package this one may not import. */
const legacyRule: AdapterSelectionRule = {
  adapter: 'legacy-angular',
  advertises: source =>
    source !== null &&
    typeof source === 'object' &&
    typeof (source as Record<string, unknown>)['mfManifestUrl'] === 'string',
  normalize: (source): NeutralRegistryEntry => ({
    id: (source as Record<string, string>)['id'] ?? '',
    definitionKind: 'app',
    adapter: 'legacy-angular',
    manifestUrl: (source as Record<string, string>)['mfManifestUrl'] ?? '',
  }),
}

function wire(rules?: readonly AdapterSelectionRule[]): MfeRuntimeHandle {
  handle = createMfeRuntime({
    registryEntries: [LEGACY_ENTRY],
    loader: createInProcessLoader(new Map()),
    shellState: { user: null, groups: [], theme: 'dark' },
    telemetryProvider: createNoopTelemetryProvider(),
    sessionGeneration: 'gen-1',
    overrideStorage: { getItem: () => null },
    ...(rules === undefined ? {} : { rules }),
  })
  return handle
}

it('quarantines an entry no registered rule advertises', () => {
  const { runtime } = wire()

  expect(runtime.registry.entries.has('billing')).toBe(false)
  expect(runtime.registry.quarantined.map(entry => entry.id)).toEqual(['billing'])
})

it('accepts that entry through a rule the caller registers behind the contract rule', () => {
  const { runtime } = wire([legacyRule])

  expect(runtime.registry.quarantined).toEqual([])
  expect(runtime.registry.entries.get('billing')?.adapter).toBe('legacy-angular')
})
