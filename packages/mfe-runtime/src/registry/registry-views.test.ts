import type { Registry, RegistryEntry } from '@company/mfe-core'
import { describe, expect, it } from 'vitest'

import {
  activeDefinition,
  capabilityPages,
  listApps,
  listEntries,
  listWidgets,
} from './registry-views.ts'

function entry(overrides: Partial<RegistryEntry> & { id: string }): RegistryEntry {
  return {
    definitionKind: 'app',
    adapter: 'react',
    manifestUrl: `https://example.test/${overrides.id}/mf-manifest.json`,
    ...overrides,
  }
}

const OPERATIONS = entry({
  id: 'operations',
  capabilities: [
    { name: 'settings', label: 'Operations settings', path: '/settings' },
    { name: 'help', label: 'Operations help', path: '/help' },
  ],
})
const HIDDEN_APP = entry({
  id: 'internal-tools',
  hidden: true,
  capabilities: [{ name: 'settings', label: 'Internal settings', path: '/settings' }],
})
const ALERT_PANEL = entry({ id: 'alert-panel', definitionKind: 'widget' })
const HIDDEN_WIDGET = entry({ id: 'scratch-widget', definitionKind: 'widget', hidden: true })

function registryOf(entries: readonly RegistryEntry[]): Registry {
  return { entries: new Map(entries.map(item => [item.id, item])), rejected: [] }
}

describe('the registry views', () => {
  const registry = registryOf([OPERATIONS, HIDDEN_APP, ALERT_PANEL, HIDDEN_WIDGET])

  it('lists every entry, and only the Apps and Widgets a catalogue offers', () => {
    expect(listEntries(registry)).toEqual([OPERATIONS, HIDDEN_APP, ALERT_PANEL, HIDDEN_WIDGET])
    expect(listApps(registry)).toEqual([OPERATIONS])
    expect(listWidgets(registry)).toEqual([ALERT_PANEL])
  })

  it('flattens the capability pages of listed Apps, by name when asked', () => {
    expect(capabilityPages(registry).map(page => page.capability.label)).toEqual([
      'Operations settings',
      'Operations help',
    ])
    expect(capabilityPages(registry, 'settings')).toEqual([
      { app: OPERATIONS, capability: OPERATIONS.capabilities?.[0] },
    ])
  })

  /** Every host component reads these, so none of them may copy the registry again. */
  it('hands every caller the same frozen list for as long as the registry lives', () => {
    expect(listApps(registry)).toBe(listApps(registry))
    expect(listEntries(registry)).toBe(listEntries(registry))
    expect(capabilityPages(registry, 'help')).toBe(capabilityPages(registry, 'help'))
    expect(Object.isFrozen(listWidgets(registry))).toBe(true)

    const another = registryOf([OPERATIONS])
    expect(listApps(another)).not.toBe(listApps(registry))
  })

  it('names the App a boundary id points at, and never a Widget', () => {
    expect(activeDefinition(registry, undefined)).toBeNull()
    expect(activeDefinition(registry, 'operations')).toEqual({
      id: 'operations',
      entry: OPERATIONS,
    })
    expect(activeDefinition(registry, 'internal-tools')?.entry).toBe(HIDDEN_APP)
    expect(activeDefinition(registry, 'alert-panel')).toEqual({
      id: 'alert-panel',
      entry: undefined,
    })
    expect(activeDefinition(registry, 'nowhere')).toEqual({ id: 'nowhere', entry: undefined })
  })
})
