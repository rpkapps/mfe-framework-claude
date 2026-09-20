import { describe, expect, it } from 'vitest'

import type { NeutralRegistryEntry } from '@company/mfe-core'

import { capabilityRoute } from './capability-route.ts'

function entry(overrides: Partial<NeutralRegistryEntry> = {}): NeutralRegistryEntry {
  return {
    id: 'operations',
    definitionKind: 'app',
    adapter: 'react',
    manifestUrl: 'https://cdn.example.test/operations/mf-manifest.json',
    ...overrides,
  }
}

describe('capabilityRoute', () => {
  it('answers with the path the App advertised for that capability', () => {
    const operations = entry({
      capabilities: [
        { name: 'settings', label: 'Operations settings', path: '/settings' },
        { name: 'releaseNotes', label: "What's new", path: '/release-notes' },
      ],
    })

    expect(capabilityRoute(operations, 'settings')).toBe('/settings')
    expect(capabilityRoute(operations, 'releaseNotes')).toBe('/release-notes')
  })

  it('answers with nothing for a capability the App does not advertise', () => {
    const operations = entry({
      capabilities: [{ name: 'settings', label: 'Operations settings', path: '/settings' }],
    })

    expect(capabilityRoute(operations, 'help')).toBeUndefined()
  })

  it('answers with nothing for an entry that advertises none at all', () => {
    expect(capabilityRoute(entry(), 'releaseNotes')).toBeUndefined()
    expect(capabilityRoute(entry({ capabilities: [] }), 'releaseNotes')).toBeUndefined()
  })

  it('takes the first of two entries claiming one capability, deterministically', () => {
    const operations = entry({
      capabilities: [
        { name: 'help', label: 'Help', path: '/help' },
        { name: 'help', label: 'Help, again', path: '/docs' },
      ],
    })

    expect(capabilityRoute(operations, 'help')).toBe('/help')
  })
})
