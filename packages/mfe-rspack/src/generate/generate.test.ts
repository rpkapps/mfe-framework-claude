import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupContainers, createContainer } from '../testing/fixtures.ts'
import { planContainer } from '../plan.ts'
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

    const names = plan.generated.files.map(file => file.path.slice(root.length + 1)).sort()

    expect(names).toEqual([
      '.mfe/.env.example',
      '.mfe/.gitignore',
      '.mfe/config.ts',
      '.mfe/entries/app.ts',
      '.mfe/fetch.ts',
      '.mfe/meta.ts',
      '.mfe/mfe-registry.json',
      '.mfe/runtime-config.schema.json',
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
  it('re-exports a bound fetch instead of patching the global one', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const source = fileFor('fetch.ts')

    expect(source).toContain("from '@company/mfe-host'")
    expect(source).toContain('export { authenticatedFetch as fetch }')
    expect(source).toContain('export function getAccessToken(')
    expect(source).not.toContain('globalThis.fetch =')
    expect(source).not.toContain('window.fetch =')
  })

  it('binds only the origins declared with { api: true }', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const source = fileFor('fetch.ts')

    expect(source).toContain('new URL(config.apiBaseUrl).origin,')
    expect(source).not.toContain('config.oidcIssuer')
  })

  it('binds an empty allowlist when the container declares no API origin', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY })

    expect(fileFor('fetch.ts')).toContain('Object.freeze([])')
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

describe('shell registry descriptor', () => {
  it('names the definitions, the shared manifest and the contract major', () => {
    const { fileFor, plan } = planFixture({
      'src/mfe.ts': APP_ENTRY,
      'src/routes/settings.tsx': ROUTE,
    })

    expect(JSON.parse(fileFor('mfe-registry.json'))).toEqual({
      manifestUrl: 'mf-manifest.json',
      contractMajor: 1,
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
