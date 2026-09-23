import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildFederationOptions, withFrameworkMetadata } from './federation/federation-options.ts'
import { planContainer } from './plan.ts'
import { pluginMfe } from './rsbuild.ts'
import { cleanupContainers, createContainer } from './testing/fixtures.ts'

afterEach(cleanupContainers)

const ENTRY = `
import { createApp, createWidget } from '@company/mfe-react'
import { z } from 'zod'

import { makeRouter } from './router.ts'

export const operations = createApp({ id: 'operations', version: '2.1.0', router: makeRouter })

export const orderRow = createWidget({
  id: 'order-row',
  inputs: z.object({ orderId: z.string() }),
  events: { acknowledged: z.object({ at: z.string() }) },
  render: () => null,
})
`

describe('pluginMfe', () => {
  it('is an ordinary Rsbuild plugin, constructed without touching the disk', () => {
    const config = {
      source: { entry: { index: './src/mfe.ts' } },
      plugins: [pluginMfe()],
    }

    expect(config.plugins[0]?.name).toBe('mfe')
    expect(typeof config.plugins[0]?.setup).toBe('function')
  })

  it('accepts the supported options', () => {
    expect(() =>
      pluginMfe({ shared: { '@company/auth-client': '^3.0.0' }, reactCompiler: false }),
    ).not.toThrow()
  })

  it('plans a container from its own sources', () => {
    const root = createContainer({ 'src/mfe.ts': ENTRY })
    const plan = planContainer({ containerRoot: root })

    expect(plan.discovery.definitions.map(definition => definition.id)).toEqual([
      'operations',
      'order-row',
    ])
    expect(plan.exposes).toEqual({
      './app': join(root, '.mfe/entries/app.ts'),
      './widgets/order-row': join(root, '.mfe/entries/widgets/order-row.ts'),
    })
    expect(plan.scopes).toEqual(['operations', 'order-row'])
  })

  it('keeps the sharing defaults when an author adds a package', () => {
    const root = createContainer({ 'src/mfe.ts': ENTRY })
    const plan = planContainer({
      containerRoot: root,
      shared: { '@company/auth-client': '^3.0.0' },
    })

    expect(Object.keys(plan.shared)).toEqual(['@company/auth-client', 'react', 'react-dom'])
    expect(plan.shared['react']).toMatchObject({ singleton: true, strictVersion: true })
  })

  it('reports an asset reference the bundler cannot make container-relative', () => {
    const root = createContainer({
      'src/mfe.ts': ENTRY,
      'src/logo.ts': 'export const logo = `./assets/logo.svg`\n',
    })

    const plan = planContainer({ containerRoot: root })

    expect(plan.diagnostics).toHaveLength(1)
    expect(plan.diagnostics[0]?.message).toContain('import.meta.url')
  })

  it('reports definitions declared outside the entry as build diagnostics', () => {
    const root = createContainer({
      'src/mfe.ts': ENTRY,
      'src/widgets/stray.ts': `
import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

export const stray = createWidget({ id: 'stray', inputs: z.object({}), events: {}, render: () => null })
`,
    })

    const plan = planContainer({ containerRoot: root })

    expect(plan.diagnostics).toHaveLength(1)
    expect(plan.diagnostics[0]?.message).toContain('stray.ts')
  })
})

describe('Module Federation options', () => {
  it('derives the container name, exposes and sharing', () => {
    const root = createContainer({ 'src/mfe.ts': ENTRY })
    const plan = planContainer({ containerRoot: root })
    const options = buildFederationOptions(plan)

    expect(options.name).toBe('acme_operations')
    expect(options.filename).toBe('remoteEntry.js')
    expect(Object.keys(options.exposes)).toEqual(['./app', './widgets/order-row'])
    expect(options.manifest.fileName).toBe('mf-manifest.json')
  })

  it('embeds the framework metadata in the manifest metadata, not a second manifest', () => {
    const root = createContainer({ 'src/mfe.ts': ENTRY })
    const plan = planContainer({ containerRoot: root, buildTime: '2026-01-02T03:04:05.000Z' })
    const options = buildFederationOptions(plan)

    // Injected into the emitted manifest rather than through the hook Rsbuild replaces (§13).
    const manifest = withFrameworkMetadata(
      { id: 'acme_operations', metaData: { name: 'acme_operations', type: 'app' } },
      plan.generated.frameworkMetadata,
    ) as { metaData: Record<string, unknown>; id: string }

    expect(options.manifest.fileName).toBe('mf-manifest.json')

    expect(manifest.id).toBe('acme_operations')
    expect(manifest.metaData['name']).toBe('acme_operations')
    expect(manifest.metaData['mfe']).toMatchObject({
      kind: 'mfe',
      major: 1,
      buildTime: '2026-01-02T03:04:05.000Z',
      registryDescriptor: 'mfe-registry.json',
      entries: { operations: './app', 'order-row': './widgets/order-row' },
    })
  })

  it('never drops what the Module Federation plugin already wrote', () => {
    const merged = withFrameworkMetadata(
      { shared: [], metaData: { globalName: 'x' } },
      {
        kind: 'mfe',
        major: 1,
        framework: 'react',
        buildHash: 'abc',
        buildTime: 't',
        registryDescriptor: 'mfe-registry.json',
        definitions: [],
        entries: {},
      },
    )

    expect(merged).toMatchObject({ shared: [], metaData: { globalName: 'x' } })
    expect((merged['metaData'] as Record<string, unknown>)['mfe']).toBeDefined()
  })
})
