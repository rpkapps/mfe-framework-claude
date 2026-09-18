import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupContainers, createContainer } from '../testing/fixtures.ts'
import { extractCapabilities } from './capabilities.ts'

afterEach(cleanupContainers)

function route(path: string, staticData: string): string {
  return `
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('${path}')({
  staticData: ${staticData},
  component: () => null,
})
`
}

function capabilitiesOf(files: Readonly<Record<string, string>>, hasApp = true) {
  const root = createContainer(files)
  return extractCapabilities({
    routesDirectory: join(root, 'src/routes'),
    hasApp,
    ...(hasApp ? { appId: 'operations' } : {}),
  })
}

describe('extractCapabilities', () => {
  it('reads a marked route, taking the path from createFileRoute', () => {
    const capabilities = capabilitiesOf({
      'src/routes/settings.tsx': route(
        '/settings',
        "{ capability: 'settings', label: 'Order settings', icon: 'gear' }",
      ),
    })

    expect(capabilities).toEqual([
      { name: 'settings', label: 'Order settings', icon: 'gear', path: '/settings' },
    ])
  })

  it('ignores routes without a capability marker', () => {
    const capabilities = capabilitiesOf({
      'src/routes/index.tsx': route('/', "{ title: 'Home' }"),
      'src/routes/help.tsx': route('/help', "{ capability: 'help', label: 'Help' }"),
    })

    expect(capabilities.map(capability => capability.name)).toEqual(['help'])
  })

  it('returns capabilities in a stable order', () => {
    const capabilities = capabilitiesOf({
      'src/routes/release-notes.tsx': route(
        '/whats-new',
        "{ capability: 'releaseNotes', label: 'What is new' }",
      ),
      'src/routes/settings.tsx': route('/settings', "{ capability: 'settings', label: 'Settings' }"),
      'src/routes/help.tsx': route('/help', "{ capability: 'help', label: 'Help' }"),
    })

    expect(capabilities.map(capability => capability.name)).toEqual([
      'settings',
      'help',
      'releaseNotes',
    ])
  })

  it('returns nothing when the container has no routes directory', () => {
    expect(capabilitiesOf({ 'src/mfe.ts': 'export {}\n' })).toEqual([])
  })

  it('rejects an unknown capability name', () => {
    expect(() =>
      capabilitiesOf({
        'src/routes/admin.tsx': route('/admin', "{ capability: 'admin', label: 'Admin' }"),
      }),
    ).toThrow(/'settings', 'help' and 'releaseNotes'/)
  })

  it('rejects a capability declared by a Widget-only container', () => {
    expect(() =>
      capabilitiesOf(
        {
          'src/routes/settings.tsx': route(
            '/settings',
            "{ capability: 'settings', label: 'Settings' }",
          ),
        },
        false,
      ),
    ).toThrow(/Capabilities are App-only/)
  })

  it('requires a label', () => {
    expect(() =>
      capabilitiesOf({
        'src/routes/settings.tsx': route('/settings', "{ capability: 'settings' }"),
      }),
    ).toThrow(/label/)
  })

  it('rejects two routes claiming the same capability', () => {
    expect(() =>
      capabilitiesOf({
        'src/routes/a.tsx': route('/a', "{ capability: 'help', label: 'A' }"),
        'src/routes/b.tsx': route('/b', "{ capability: 'help', label: 'B' }"),
      }),
    ).toThrow(/one route per capability/)
  })

  it('accepts an icon given as a src object', () => {
    const capabilities = capabilitiesOf({
      'src/routes/settings.tsx': route(
        '/settings',
        "{ capability: 'settings', label: 'Settings', icon: { src: '/icons/gear.svg' } }",
      ),
    })

    expect(capabilities[0]?.icon).toEqual({ src: '/icons/gear.svg' })
  })

  it('accepts a capability without an icon', () => {
    const capabilities = capabilitiesOf({
      'src/routes/settings.tsx': route('/settings', "{ capability: 'settings', label: 'Settings' }"),
    })

    expect(capabilities[0]).not.toHaveProperty('icon')
  })

  it('never accepts author SVG markup as an icon', () => {
    expect(() =>
      capabilitiesOf({
        'src/routes/settings.tsx': route(
          '/settings',
          "{ capability: 'settings', label: 'Settings', icon: '<svg viewBox=\"0 0 1 1\"></svg>' }",
        ),
      }),
    ).toThrow(/SVG source is not accepted/)
  })

  it('never accepts an SVG data URL as an icon source', () => {
    expect(() =>
      capabilitiesOf({
        'src/routes/settings.tsx': route(
          '/settings',
          "{ capability: 'settings', label: 'Settings', icon: { src: 'data:image/svg+xml;utf8,<svg/>' } }",
        ),
      }),
    ).toThrow(/markup/)
  })

  it('rejects an icon object carrying more than a src', () => {
    expect(() =>
      capabilitiesOf({
        'src/routes/settings.tsx': route(
          '/settings',
          "{ capability: 'settings', label: 'Settings', icon: { src: '/a.svg', title: 'Gear' } }",
        ),
      }),
    ).toThrow(/single src property/)
  })

  it('rejects a computed capability name', () => {
    expect(() =>
      capabilitiesOf({
        'src/routes/settings.tsx': route(
          '/settings',
          '{ capability: CAPABILITY, label: "Settings" }',
        ),
      }),
    ).toThrow(/plain string literal/)
  })
})
