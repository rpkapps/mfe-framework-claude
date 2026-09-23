import { readFileSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupContainers, createContainer } from '../testing/fixtures.ts'
import { planContainer, type ContainerPlan } from '../plan.ts'
import { generateContainer } from './container.ts'
import { writeGeneratedFiles } from './emit.ts'

afterEach(cleanupContainers)

const BUILD_TIME = '2026-01-02T03:04:05.000Z'

const APP_ENTRY = `
import { createApp } from '@company/mfe-react'
import { makeRouter } from './router.ts'

export const operations = createApp({ id: 'operations', version: '2.1.0', router: makeRouter })
`

const CONFIG = `
import { env } from '@company/mfe-rspack'
import { z } from 'zod'

export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
  oidcIssuer: env('OIDC_ISSUER', z.string().url()),
  pageSize: env('PAGE_SIZE', z.number().int().min(1).max(200).default(25)),
  mode: env('MODE', z.enum(['staging', 'production']).optional()),
}
`

const ROUTE = `
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  staticData: { capability: 'settings', label: 'Order settings', icon: 'gear' },
  component: () => null,
})
`

function planFixture(files: Readonly<Record<string, string>>, manifest?: Record<string, unknown>) {
  const root = createContainer(files, manifest === undefined ? {} : { manifest })
  const plan = planContainer({ containerRoot: root, buildTime: BUILD_TIME })
  const fileFor = (relativePath: string): string => {
    const target = join(root, '.mfe', relativePath)
    const generated = plan.generated.files.find(file => file.path === target)
    if (generated === undefined) {
      throw new Error(
        `no generated file at ${relativePath}: ${plan.generated.files.map(f => f.path).join(', ')}`,
      )
    }
    return generated.contents
  }
  return { root, plan, fileFor }
}

describe('generated inventory', () => {
  it('generates the three aliases plus the build artifacts', () => {
    const { root, plan } = planFixture({
      'src/mfe.ts': APP_ENTRY,
      'src/mfe.config.ts': CONFIG,
      'src/routes/settings.tsx': ROUTE,
    })

    // A plan carries real OS paths, so these names are the generated spelling of them.
    const names = plan.generated.files
      .map(file =>
        file.path
          .slice(root.length + 1)
          .split(sep)
          .join('/'),
      )
      .sort()

    expect(names).toEqual([
      '.mfe/.env.example',
      '.mfe/.gitignore',
      '.mfe/config.ts',
      '.mfe/css.d.ts',
      '.mfe/entries/app.ts',
      '.mfe/entries/container.ts',
      '.mfe/fetch.ts',
      '.mfe/meta.ts',
      '.mfe/mfe-registry.json',
      '.mfe/runtime-config.defaults.json',
      '.mfe/runtime-config.schema.json',
      '.mfe/runtime-config.sh',
      '.mfe/styles.css',
      '.mfe/tsconfig.paths.json',
    ])
  })

  it('maps exactly the three author-facing aliases', () => {
    const { root, plan } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })

    expect(plan.aliases).toEqual({
      '#mfe/config': join(root, '.mfe/config.ts'),
      '#mfe/fetch': join(root, '.mfe/fetch.ts'),
      '#mfe/meta': join(root, '.mfe/meta.ts'),
    })
  })

  it('omits #mfe/config when the container declares no configuration', () => {
    const { plan } = planFixture({ 'src/mfe.ts': APP_ENTRY })

    expect(Object.keys(plan.aliases)).toEqual(['#mfe/fetch', '#mfe/meta'])
  })

  it('is deterministic for the same sources', () => {
    const files = { 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG }
    const first = planFixture(files)
    const second = planFixture(files)

    expect(first.plan.generated.buildHash).not.toBe('')
    expect(second.fileFor('config.ts')).toBe(first.fileFor('config.ts'))
    expect(second.fileFor('meta.ts')).toBe(first.fileFor('meta.ts'))
  })

  it('writes only the files that changed', () => {
    const { plan } = planFixture({ 'src/mfe.ts': APP_ENTRY })

    expect(writeGeneratedFiles(plan.generated.files)).toHaveLength(plan.generated.files.length)
    expect(writeGeneratedFiles(plan.generated.files)).toHaveLength(0)
  })
})

/** A container that renders the design system, installed the way pnpm installs a linked one. */
const TECTON_MANIFEST = {
  dependencies: {
    react: '^19.0.0',
    'react-dom': '^19.0.0',
    '@tecton/react': 'link:../../../tecton-ui-1/packages/tecton-react',
  },
}

describe('the container stylesheet', () => {
  it('compiles Tailwind and the design system without any page-level CSS', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY }, TECTON_MANIFEST)
    const stylesheet = fileFor('styles.css')

    expect(stylesheet).toContain('@layer theme, base, components, utilities;')
    expect(stylesheet).toContain('@import "tailwindcss/theme.css" layer(theme);')
    expect(stylesheet).toContain('@import "tailwindcss/utilities.css" layer(utilities);')
    expect(stylesheet).toContain('@import "@tecton/react/styles/scoped.css";')
    expect(stylesheet).not.toContain('@import "tailwindcss";')
    expect(stylesheet).not.toContain('globals.css')
    expect(stylesheet).not.toContain(':root {')
    expect(stylesheet).not.toMatch(/^\s*--/m)
  })

  it('scans the container source', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY }, TECTON_MANIFEST)
    const stylesheet = fileFor('styles.css')

    expect(stylesheet).toContain('@source "../src/**/*.{ts,tsx}";')
  })

  it('names no design system for a container that does not use one', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY })
    const stylesheet = fileFor('styles.css')

    expect(stylesheet).toContain('@import "tailwindcss/utilities.css" layer(utilities);')
    expect(stylesheet).not.toContain('@tecton/react')
  })
})

describe('the exposed federation entry', () => {
  it('imports the stylesheet, so it loads with whichever expose is asked for', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY }, TECTON_MANIFEST)
    const source = fileFor('entries/app.ts')

    expect(source).toContain("import '../styles.css'")
    expect(source.indexOf("import '../styles.css'")).toBeLessThan(source.indexOf('src/mfe.ts'))
  })

  it('exposes the definition with the design system root attached', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY }, TECTON_MANIFEST)
    const source = fileFor('entries/app.ts')

    expect(source).toContain("import { withStyleRoot } from '@company/mfe-react'")
    expect(source).toContain("import { operations as authored } from '../../src/mfe.ts'")
    expect(source).toContain("import { StyleRoot } from './style-root.tsx'")
    expect(source).toContain('export const definition = withStyleRoot(authored, StyleRoot)')
  })

  it('re-exports the author definition unchanged without a design system', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY })
    const source = fileFor('entries/app.ts')

    expect(source).toContain("export { operations as definition } from '../../src/mfe.ts'")
    expect(source).toContain("import '../styles.css'")
    expect(source).not.toContain('withStyleRoot')
  })

  it('keeps the configuration import ahead of the application modules', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const source = fileFor('entries/app.ts')

    expect(source.indexOf("import '../config.ts'")).toBeLessThan(source.indexOf('src/mfe.ts'))
  })
})

describe('the style root', () => {
  it('renders the design system root from the container own bundle', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY }, TECTON_MANIFEST)
    const source = fileFor('entries/style-root.tsx')

    expect(source).toContain("import { ThemeRoot } from '@tecton/react/tecton/theme-root'")
    expect(source).toContain('<ThemeRoot overlayContainer={overlayContainer}')
    expect(source).toContain("overlayContainer.setAttribute('data-tecton-root', '')")
    expect(source).toContain("const LAYOUT_NEUTRAL = { display: 'contents' } as const")
  })

  it('is not generated for a container that renders no design system', () => {
    const { plan } = planFixture({ 'src/mfe.ts': APP_ENTRY })

    expect(plan.generated.files.some(file => file.path.endsWith('style-root.tsx'))).toBe(false)
  })
})

describe('#mfe/config', () => {
  it('loads the external file, validates it and fails explicitly', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const source = fileFor('config.ts')

    expect(source).toContain("Application code imports this module as '#mfe/config'")
    expect(source).toContain(
      "new URL('runtime-config.json', new URL(assetBase, documentBase)).href",
    )
    expect(source).toContain("'config/missing'")
    expect(source).toContain("'config/unreachable'")
    expect(source).toContain("'config/invalid'")
    expect(source).toContain('export const config: MfeConfig = validate(await readValues())')
    expect(source).toContain('Object.freeze(parsed)')
    expect(source).not.toMatch(/return\s*\{\s*\}/)
    expect(source).not.toContain('?? {}')
    expect(source).not.toContain('setInterval')
  })

  it('validates through the author schemas, so declared defaults apply', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const source = fileFor('config.ts')

    expect(source).toContain('descriptors[spec.field].schema.safeParse(values[spec.field])')
    expect(source).toContain("{ field: 'pageSize', envVar: 'PAGE_SIZE'")
  })

  it('rejects keys the container never declared', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })

    expect(fileFor('config.ts')).toContain('only the declared fields')
  })
})

describe('#mfe/fetch', () => {
  it('exports a bound fetch instead of patching the global one', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const source = fileFor('fetch.ts')

    expect(source).toContain("import { createContainerTransport } from '@company/mfe-react'")
    expect(source).toContain('export const { fetch, getAccessToken } = transport')
    expect(source).not.toContain('globalThis.fetch =')
    expect(source).not.toContain('window.fetch =')
  })

  it('binds only the origins declared with { api: true }', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const source = fileFor('fetch.ts')

    expect(source).toContain('new URL(config.apiBaseUrl).origin,')
    expect(source).not.toContain('config.oidcIssuer')
  })

  it('makes the first declared API the default base', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })

    expect(fileFor('fetch.ts')).toContain('apiBaseUrl: config.apiBaseUrl,')
  })

  it('binds an empty allowlist and no base when the container declares no API origin', () => {
    const source = planFixture({ 'src/mfe.ts': APP_ENTRY }).fileFor('fetch.ts')

    expect(source).toContain('Object.freeze([])')
    expect(source).not.toContain('apiBaseUrl:')
    expect(source).not.toContain("from './config.ts'")
  })
})

describe('#mfe/meta', () => {
  it('carries the build hash, build time and the exported definitions', () => {
    const { fileFor, plan } = planFixture({ 'src/mfe.ts': APP_ENTRY })
    const source = fileFor('meta.ts')

    expect(source).toContain(`export const buildHash = '${plan.generated.buildHash}'`)
    expect(source).toContain(`export const buildTime = '${BUILD_TIME}'`)
    expect(source).toContain("{ id: 'operations', kind: 'app', version: '2.1.0' },")
    expect(source).toContain('export const contractMajor = 1')
  })
})

describe('the recorded build time', () => {
  const recordedTime = (plan: ContainerPlan): string => {
    const meta = plan.generated.files.find(file => file.path.endsWith('meta.ts'))
    const match = /export const buildTime = '([^']+)'/.exec(meta?.contents ?? '')
    if (match === null) throw new Error('no build time in the generated meta module')
    return match[1] ?? ''
  }

  const wroteMeta = (written: readonly { readonly path: string }[]): boolean =>
    written.some(file => file.path.endsWith('meta.ts'))

  it('stays put while the generated shape is unchanged', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })

    const first = generateContainer({ containerRoot: root })
    const second = generateContainer({ containerRoot: root })

    expect(wroteMeta(first.written)).toBe(true)
    expect(second.written).toEqual([])
    expect(recordedTime(second.plan)).toBe(recordedTime(first.plan))
  })

  it('is taken again when the shape changes', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })
    const first = generateContainer({ containerRoot: root })

    // A container may export one App, so the shape changes by gaining a Widget.
    writeFileSync(
      join(root, 'src/mfe.ts'),
      `${APP_ENTRY}
import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

export const alertPanel = createWidget({
  id: 'alert-panel',
  inputs: z.object({}),
  events: {},
  render: () => null,
})
`,
      'utf8',
    )
    const second = generateContainer({ containerRoot: root })

    expect(second.plan.generated.buildHash).not.toBe(first.plan.generated.buildHash)
    expect(wroteMeta(second.written)).toBe(true)
  })

  it('is whatever a caller fixed it to, regardless of what is on disk', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })
    generateContainer({ containerRoot: root })

    const pinned = planContainer({ containerRoot: root, buildTime: BUILD_TIME })

    expect(recordedTime(pinned)).toBe(BUILD_TIME)
  })
})

describe('the registry entry the build publishes', () => {
  it('names the definitions, the shared manifest and the contract major', () => {
    const { fileFor, plan } = planFixture({
      'src/mfe.ts': APP_ENTRY,
      'src/routes/settings.tsx': ROUTE,
    })

    expect(JSON.parse(fileFor('mfe-registry.json'))).toEqual({
      manifestUrl: 'mf-manifest.json',
      container: 'acme_operations',
      entries: { operations: './app' },
      contractMajor: 1,
      framework: 'react',
      definitions: [
        {
          id: 'operations',
          kind: 'app',
          version: '2.1.0',
          capabilities: [
            { name: 'settings', label: 'Order settings', icon: 'gear', path: '/settings' },
          ],
        },
      ],
      build: { hash: plan.generated.buildHash, time: BUILD_TIME },
    })
  })

  it('carries capability metadata on the App only', () => {
    const { fileFor } = planFixture({
      'src/mfe.ts': `${APP_ENTRY}
import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

export const orderRow = createWidget({
  id: 'order-row',
  inputs: z.object({ orderId: z.string() }),
  events: {},
  render: () => null,
})
`,
      'src/routes/settings.tsx': ROUTE,
    })

    const descriptor = JSON.parse(fileFor('mfe-registry.json')) as {
      definitions: { id: string; capabilities?: unknown }[]
    }

    expect(descriptor.definitions[0]?.capabilities).toHaveLength(1)
    expect(descriptor.definitions[1]).not.toHaveProperty('capabilities')
  })
})

describe('published Widget contract', () => {
  const WIDGET = `
import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

export const alertPanel = createWidget({
  id: 'alert-panel',
  version: '1.4.0',
  inputs: z.object({
    alertId: z.string(),
    severity: z.enum(['info', 'warning', 'critical']).default('info'),
    muted: z.boolean().optional(),
  }),
  events: { acknowledged: z.object({ alertId: z.string() }) },
  render: () => null,
})
`

  it('publishes the inputs as JSON Schema and the declared event names', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': WIDGET })
    const descriptor = JSON.parse(fileFor('mfe-registry.json')) as {
      definitions: { contract?: Record<string, unknown> }[]
    }

    expect(descriptor.definitions[0]?.contract).toEqual({
      events: ['acknowledged'],
      inputs: {
        title: 'alert-panel inputs',
        type: 'object',
        properties: {
          alertId: { type: 'string' },
          severity: { enum: ['info', 'warning', 'critical'], default: 'info' },
          muted: { type: 'boolean' },
        },
        required: ['alertId'],
        additionalProperties: false,
      },
    })
  })

  it('publishes nothing of the kind for an App', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY })
    const descriptor = JSON.parse(fileFor('mfe-registry.json')) as {
      definitions: Record<string, unknown>[]
    }

    expect(descriptor.definitions[0]).not.toHaveProperty('contract')
  })

  it('publishes the events alone when the inputs schema is not statically readable', () => {
    const { fileFor } = planFixture({
      'src/mfe.ts': `
import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

export const oddPanel = createWidget({
  id: 'odd-panel',
  inputs: z.object({ when: z.string() }).refine(value => value.when !== ''),
  events: { picked: z.object({}) },
  render: () => null,
})
`,
    })

    const descriptor = JSON.parse(fileFor('mfe-registry.json')) as {
      definitions: { contract?: Record<string, unknown> }[]
    }

    expect(descriptor.definitions[0]?.contract).toEqual({ events: ['picked'] })
  })
})

describe('runtime-config JSON Schema', () => {
  it('describes the declared values and nothing else', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const schema = JSON.parse(fileFor('runtime-config.schema.json')) as Record<string, unknown>

    expect(schema['additionalProperties']).toBe(false)
    expect(schema['required']).toEqual(['apiBaseUrl', 'oidcIssuer'])
    expect(schema['properties']).toMatchObject({
      apiBaseUrl: { type: 'string', format: 'uri' },
      pageSize: { type: 'integer', minimum: 1, maximum: 200, default: 25 },
      mode: { enum: ['staging', 'production'] },
    })
  })

  it('reports a schema it cannot read rather than emitting an empty one', () => {
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/mfe.config.ts': `
import { env } from '@company/mfe-rspack'
import { z } from 'zod'

export default {
  weird: env('WEIRD', z.custom(value => typeof value === 'string')),
}
`,
    })

    expect(() => planContainer({ containerRoot: root })).toThrow(/z\.custom/)
  })

  it('refuses a schema that swallows an invalid value', () => {
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/mfe.config.ts': `
import { env } from '@company/mfe-rspack'
import { z } from 'zod'

export default { retries: env('RETRIES', z.number().catch(3)) }
`,
    })

    expect(() => planContainer({ containerRoot: root })).toThrow(/instead of reporting it/)
  })
})

describe('.env.example', () => {
  it('lists every declared variable, with no values', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const example = fileFor('.env.example')

    expect(example).toContain('API_BASE_URL=\n')
    expect(example).toContain('OIDC_ISSUER=\n')
    expect(example).toContain('PAGE_SIZE=\n')
    expect(example).toContain('MODE=\n')
    expect(example).toContain('# Required.')
    expect(example).toContain('# Optional. Defaults to 25.')
    expect(example).toContain("container's authentication allowlist")
    expect(example).not.toMatch(/=\S/)
  })
})

describe('Widget contract entry points', () => {
  const WIDGET_INLINE = `
import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

export const orderRow = createWidget({
  id: 'order-row',
  inputs: z.object({ orderId: z.string() }),
  events: { acknowledged: z.object({ at: z.string() }) },
  render: () => null,
})
`

  it('carries the schemas and the inferred types', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': WIDGET_INLINE })
    const source = fileFor('widgets/order-row.contract.ts')

    expect(source).toContain("export const widgetId = 'order-row'")
    expect(source).toContain('export const inputs = z.object({ orderId: z.string() })')
    expect(source).toContain('export const events = { acknowledged: z.object({ at: z.string() }) }')
    expect(source).toContain('export type Inputs = z.infer<typeof inputs>')
    expect(source).toContain("readonly acknowledged: z.infer<(typeof events)['acknowledged']>")
  })

  it('imports no App entry, route tree, generated config or router augmentation', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': `${APP_ENTRY}\n${WIDGET_INLINE}` })
    const source = fileFor('widgets/order-row.contract.ts')

    expect(source).not.toContain('src/mfe.ts')
    expect(source).not.toContain('routeTree')
    expect(source).not.toContain('#mfe/config')
    expect(source).not.toContain('./config.ts')
    expect(source).not.toContain('@tanstack/react-router')
  })

  it('re-exports a schema that already lives in its own module', () => {
    const { fileFor } = planFixture({
      'src/contracts/order-row.ts': `
import { z } from 'zod'

export const orderRowInputs = z.object({ orderId: z.string() })
export const orderRowEvents = { acknowledged: z.object({ at: z.string() }) }
`,
      'src/mfe.ts': `
import { createWidget } from '@company/mfe-react'

import { orderRowEvents, orderRowInputs } from './contracts/order-row.ts'

export const orderRow = createWidget({
  id: 'order-row',
  inputs: orderRowInputs,
  events: orderRowEvents,
  render: () => null,
})
`,
    })

    const source = fileFor('widgets/order-row.contract.ts')

    expect(source).toContain(
      "import { orderRowInputs as inputs } from '../../src/contracts/order-row.ts'",
    )
    expect(source).toContain('export { inputs }')
    expect(source).toContain('export { events }')
    expect(source).toContain("import type { z } from 'zod'")
  })

  it('copies the declarations an inline schema refers to', () => {
    const { fileFor } = planFixture({
      'src/mfe.ts': `
import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

const orderId = z.string().min(1)

export const orderRow = createWidget({
  id: 'order-row',
  inputs: z.object({ orderId }),
  events: {},
  render: () => null,
})
`,
    })

    const source = fileFor('widgets/order-row.contract.ts')

    expect(source).toContain('const orderId = z.string().min(1)')
    expect(source).toContain('export const inputs = z.object({ orderId })')
  })
})

describe('tsconfig path mapping', () => {
  it('declares the aliases once, for tsc and the editor', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const mapping = JSON.parse(fileFor('tsconfig.paths.json')) as {
      compilerOptions: { paths: Record<string, string[]> }
    }

    expect(mapping.compilerOptions.paths).toEqual({
      '#mfe/config': ['./config.ts'],
      '#mfe/fetch': ['./fetch.ts'],
      '#mfe/meta': ['./meta.ts'],
    })
  })
})

describe('written output', () => {
  it('lands in the build-managed directory', () => {
    const { root, plan } = planFixture({ 'src/mfe.ts': APP_ENTRY })
    writeGeneratedFiles(plan.generated.files)

    expect(readFileSync(join(root, '.mfe/.gitignore'), 'utf8')).toContain('build output')
    expect(readFileSync(join(root, '.mfe/entries/app.ts'), 'utf8')).toContain(
      "export { operations as definition } from '../../src/mfe.ts'",
    )
  })
})
