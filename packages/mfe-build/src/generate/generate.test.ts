import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'

import tailwindcss from '@tailwindcss/postcss'
import postcss from 'postcss'
import { afterEach, describe, expect, it } from 'vitest'

import type { CapabilityDescriptor } from '@company/mfe-core'

import { planContainer, type ContainerPlan } from '../plan.ts'
import type { CapabilityContext, ContainerProfile } from '../profile.ts'
import { cleanupContainers, createContainer } from '../testing/fixtures.ts'
import { TEST_PROFILE } from '../testing/profile.ts'
import { writeGeneratedFiles } from './emit.ts'

afterEach(cleanupContainers)

const BUILD_TIME = '2026-01-02T03:04:05.000Z'

/** This package's own `node_modules`, where the Tailwind a fixture links to is installed. */
const INSTALLED = join(import.meta.dirname, '../../node_modules')

const APP_ENTRY = `
import { createApp } from '@acme/mfe-adapter'
import { routes } from './routes.ts'

export const operations = createApp({ id: 'operations', version: '2.1.0', routes })
`

const CONFIG = `
import { env } from '@acme/mfe-plugin'
import { z } from 'zod'

export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
  oidcIssuer: env('OIDC_ISSUER', z.string().url()),
  pageSize: env('PAGE_SIZE', z.number().int().min(1).max(200).default(25)),
  mode: env('MODE', z.enum(['staging', 'production']).optional()),
}
`

/** What an integration's capability reader would have found in the App's routes. */
const SETTINGS: CapabilityDescriptor = {
  name: 'settings',
  label: 'Order settings',
  icon: 'gear',
  path: '/settings',
}

const WITH_CAPABILITIES: ContainerProfile = { ...TEST_PROFILE, readCapabilities: () => [SETTINGS] }

function planFixture(
  files: Readonly<Record<string, string>>,
  {
    manifest,
    profile = TEST_PROFILE,
  }: { manifest?: Record<string, unknown>; profile?: ContainerProfile } = {},
) {
  const root = createContainer(files, manifest === undefined ? {} : { manifest })
  const plan = planContainer(profile, { containerRoot: root, buildTime: BUILD_TIME })
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
    const { root, plan } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })

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

  it('names the integration in every banner, as the place to change what it wrote', () => {
    const { plan } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    // JSON has no comments; only the tsconfig mapping carries its note in a `$comment`.
    const annotated = plan.generated.files.filter(
      file => !file.path.endsWith('.json') || file.path.endsWith('tsconfig.paths.json'),
    )

    expect(annotated).toHaveLength(11)
    for (const file of annotated) {
      expect(file.contents, file.path).toContain('Generated by @acme/mfe-plugin')
    }
  })

  it("adds the integration's own files, and counts them in the build hash", () => {
    const extra: ContainerProfile = {
      ...TEST_PROFILE,
      generatedFiles: context => [
        { path: join(context.options.generatedDir, 'entries/theme.ts'), contents: 'export {}\n' },
      ],
    }
    const plain = planFixture({ 'src/mfe.ts': APP_ENTRY })
    const { plan, fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY }, { profile: extra })

    expect(fileFor('entries/theme.ts')).toBe('export {}\n')
    expect(plan.generated.files).toHaveLength(plain.plan.generated.files.length + 1)
    expect(plan.generated.buildHash).not.toBe(plain.plan.generated.buildHash)
  })
})

describe('the container stylesheet', () => {
  it('compiles Tailwind without any page-level CSS', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY })
    const stylesheet = fileFor('styles.css')

    expect(stylesheet).toContain('@layer theme, base, components, utilities;')
    expect(stylesheet).toContain('@import "tailwindcss/theme.css" layer(theme);')
    expect(stylesheet).toContain(
      '@import "tailwindcss/utilities.css" layer(utilities) source(none);',
    )
    expect(stylesheet).not.toContain('@import "tailwindcss";')
    expect(stylesheet).not.toContain('globals.css')
    expect(stylesheet).not.toContain(':root {')
    expect(stylesheet).not.toMatch(/^\s*--/m)
  })

  it('scans the container source the integration names', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY })

    expect(fileFor('styles.css')).toContain('@source "../src/**/*.{ts,html}";')
  })

  it('scans nothing else, whichever directory the build runs in', async () => {
    const { root, plan } = planFixture({
      'src/mfe.ts': APP_ENTRY,
      'src/panel.ts': `export const template = '<p class="underline">'`,
      'notes.md': '<p class="italic">',
    })
    writeGeneratedFiles(plan.generated.files)
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    symlinkSync(join(INSTALLED, 'tailwindcss'), join(root, 'node_modules/tailwindcss'), 'dir')
    const stylesheet = join(root, '.mfe/styles.css')

    // A build runs from the container root, or from a workspace root above it.
    const result = await postcss([tailwindcss({ base: root })]).process(
      readFileSync(stylesheet, 'utf8'),
      { from: stylesheet },
    )

    expect(result.css).toContain('.underline')
    expect(result.css).not.toContain('.italic')
    // Every directory Tailwind reports is one a dev server watches and rebuilds on.
    const watched = result.messages.flatMap(message => {
      const dir: unknown = message['dir']
      return message.type === 'dir-dependency' && typeof dir === 'string' ? [dir] : []
    })
    expect(watched).toEqual([join(root, 'src')])
  })

  it("adds the integration's imports after Tailwind's own, and none by default", () => {
    const withKit: ContainerProfile = {
      ...TEST_PROFILE,
      stylesheet: {
        ...TEST_PROFILE.stylesheet,
        imports: () => ['/* The UI kit. */', '@import "@acme/ui-kit/scoped.css";'],
      },
    }
    const plain = planFixture({ 'src/mfe.ts': APP_ENTRY }).fileFor('styles.css')
    const kit = planFixture({ 'src/mfe.ts': APP_ENTRY }, { profile: withKit }).fileFor('styles.css')

    expect(kit).toContain(
      '@import "tailwindcss/utilities.css" layer(utilities) source(none);\n\n/* The UI kit. */\n@import "@acme/ui-kit/scoped.css";\n',
    )
    expect(plain).not.toContain('ui-kit')
  })
})

describe('the exposed federation entry', () => {
  it('imports the stylesheet, so it loads with whichever expose is asked for', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY })
    const source = fileFor('entries/app.ts')

    expect(source).toContain("import '../styles.css'")
    expect(source.indexOf("import '../styles.css'")).toBeLessThan(source.indexOf('src/mfe.ts'))
  })

  it('imports it with the query the integration names, and declares that request', () => {
    const profile: ContainerProfile = {
      ...TEST_PROFILE,
      stylesheet: { ...TEST_PROFILE.stylesheet, query: '?acmeGlobalStyle' },
    }
    const { fileFor, plan } = planFixture({ 'src/mfe.ts': APP_ENTRY }, { profile })

    expect(fileFor('entries/app.ts')).toContain("import '../styles.css?acmeGlobalStyle'")
    expect(fileFor('css.d.ts')).toContain("declare module '*?acmeGlobalStyle'")
    expect(plan.stylesheet).toBe(join(plan.options.generatedDir, 'styles.css'))
  })

  it('re-exports the author definition unchanged by default', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY })
    const source = fileFor('entries/app.ts')

    expect(source).toContain("export { operations as definition } from '../../src/mfe.ts'")
    expect(source).toContain("import '../styles.css'")
  })

  it('exports the definition the way the integration says, after the side effects', () => {
    const seen: string[] = []
    const wrapping: ContainerProfile = {
      ...TEST_PROFILE,
      exposeDefinition: (_context, { definition, authored }) => {
        seen.push(definition.id)
        return [
          `import { ${definition.exportName} as authored } from '${authored}'`,
          'export const definition = wrap(authored)',
        ]
      },
    }
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY }, { profile: wrapping })
    const source = fileFor('entries/app.ts')

    expect(seen).toEqual(['operations'])
    expect(source).toContain("import { operations as authored } from '../../src/mfe.ts'")
    expect(source).toContain('export const definition = wrap(authored)')
    expect(source).not.toContain('as definition }')
    expect(source.indexOf("import '../styles.css'")).toBeLessThan(source.indexOf('src/mfe.ts'))
  })

  it('keeps the configuration import ahead of the application modules', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const source = fileFor('entries/app.ts')

    expect(source.indexOf("import '../config.ts'")).toBeLessThan(source.indexOf('src/mfe.ts'))
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

  it('types the configuration through the first module the integration publishes env from', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })

    expect(fileFor('config.ts')).toContain("import type { InferEnvConfig } from '@acme/mfe-plugin'")
  })

  it("reads env() only from the integration's own modules", () => {
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/mfe.config.ts': CONFIG.replace("'@acme/mfe-plugin'", "'@other/mfe-plugin'"),
    })

    expect(() => planContainer(TEST_PROFILE, { containerRoot: root })).toThrow(
      /expected an env\(…\) declaration/,
    )
  })
})

describe('#mfe/fetch', () => {
  it('exports a bound fetch instead of patching the global one', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': APP_ENTRY, 'src/mfe.config.ts': CONFIG })
    const source = fileFor('fetch.ts')

    expect(source).toContain("import { createContainerTransport } from '@acme/mfe-adapter'")
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

  /** What a build does on every compilation: plan, then write what changed. */
  const generateContainer = (root: string) => {
    const plan = planContainer(TEST_PROFILE, { containerRoot: root })
    return { plan, written: writeGeneratedFiles(plan.generated.files) }
  }

  it('stays put while the generated shape is unchanged', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })

    const first = generateContainer(root)
    const second = generateContainer(root)

    expect(wroteMeta(first.written)).toBe(true)
    expect(second.written).toEqual([])
    expect(recordedTime(second.plan)).toBe(recordedTime(first.plan))
  })

  it('is taken again when the shape changes', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })
    const first = generateContainer(root)

    // A container may export one App, so the shape changes by gaining a Widget.
    writeFileSync(
      join(root, 'src/mfe.ts'),
      `${APP_ENTRY}
import { createWidget } from '@acme/mfe-adapter'
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
    const second = generateContainer(root)

    expect(second.plan.generated.buildHash).not.toBe(first.plan.generated.buildHash)
    expect(wroteMeta(second.written)).toBe(true)
  })

  it('is whatever a caller fixed it to, regardless of what is on disk', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })
    generateContainer(root)

    const pinned = planContainer(TEST_PROFILE, { containerRoot: root, buildTime: BUILD_TIME })

    expect(recordedTime(pinned)).toBe(BUILD_TIME)
  })
})

describe('the registry entry the build publishes', () => {
  it('names the definitions, the shared manifest and the contract major', () => {
    const { fileFor, plan } = planFixture(
      { 'src/mfe.ts': APP_ENTRY },
      { profile: WITH_CAPABILITIES },
    )

    expect(JSON.parse(fileFor('mfe-registry.json'))).toEqual({
      manifestUrl: 'mf-manifest.json',
      container: 'acme_operations',
      entries: { operations: './app' },
      contractMajor: 1,
      framework: 'acme',
      shareScopes: ['default', 'acme@19.3.0'],
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
    const { fileFor } = planFixture(
      {
        'src/mfe.ts': `${APP_ENTRY}
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const orderRow = createWidget({
  id: 'order-row',
  inputs: z.object({ orderId: z.string() }),
  events: {},
  render: () => null,
})
`,
      },
      { profile: WITH_CAPABILITIES },
    )

    const descriptor = JSON.parse(fileFor('mfe-registry.json')) as {
      definitions: { id: string; capabilities?: unknown }[]
    }

    expect(descriptor.definitions[0]?.capabilities).toHaveLength(1)
    expect(descriptor.definitions[1]).not.toHaveProperty('capabilities')
  })

  it('hands the capability reader the container it is reading', () => {
    const seen: CapabilityContext[] = []
    const reading: ContainerProfile = {
      ...TEST_PROFILE,
      readCapabilities: context => {
        seen.push(context)
        return []
      },
    }
    const { root } = planFixture(
      { 'src/mfe.ts': APP_ENTRY, 'src/app/routes.ts': 'export const routes = []\n' },
      { profile: reading },
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]?.containerRoot).toBe(root)
    expect(seen[0]?.entryFile).toBe(join(root, 'src/mfe.ts'))
    expect(seen[0]?.owner).toEqual({ hasApp: true, appId: 'operations' })
    expect(seen[0]?.sourceFiles).toEqual([
      join(root, 'src/app/routes.ts'),
      join(root, 'src/mfe.ts'),
    ])
  })

  it('records the framework that built it, beside the share scopes a host registers', () => {
    const angular: ContainerProfile = { ...TEST_PROFILE, framework: 'angular' }
    const named = planFixture({ 'src/mfe.ts': APP_ENTRY }, { profile: angular })

    const descriptor = JSON.parse(named.fileFor('mfe-registry.json')) as Record<string, unknown>
    expect(Object.keys(descriptor).slice(0, 5)).toEqual([
      'manifestUrl',
      'container',
      'contractMajor',
      'framework',
      'shareScopes',
    ])
    expect(descriptor['framework']).toBe('angular')
    expect(descriptor['shareScopes']).toEqual(['default', 'angular@19.3.0'])
    expect(named.plan.generated.frameworkMetadata.framework).toBe('angular')
  })
})

describe('the share scope the build plans', () => {
  it('shares the adapter in the framework scope and what it carries in the page scope', () => {
    const root = createContainer(
      { 'src/mfe.ts': APP_ENTRY },
      {
        installed: {
          '@acme/ui-runtime': { version: '19.2.8' },
          '@acme/mfe-adapter': { version: '1.0.3', dependencies: { '@acme/mfe-kernel': '^1.0.0' } },
        },
      },
    )

    const plan = planContainer(TEST_PROFILE, { containerRoot: root, buildTime: BUILD_TIME })

    expect(plan.shared).toEqual({
      '@acme/mfe-adapter': {
        singleton: true,
        strictVersion: true,
        requiredVersion: '^1.0.0',
        shareScope: 'acme@19.2.8',
      },
      '@acme/mfe-kernel': {
        singleton: true,
        strictVersion: true,
        requiredVersion: '^1.0.0',
        shareScope: 'default',
      },
    })
    expect(plan.generated.descriptor.shareScopes).toEqual(['default', 'acme@19.2.8'])
  })

  it("prefers the container's own range for a page singleton its adapter also carries", () => {
    const root = createContainer(
      { 'src/mfe.ts': APP_ENTRY },
      {
        manifest: { dependencies: { '@acme/mfe-adapter': '^1.0.0', '@acme/mfe-kernel': '~1.0.2' } },
        installed: {
          '@acme/ui-runtime': { version: '19.3.0' },
          '@acme/mfe-adapter': { version: '1.0.3', dependencies: { '@acme/mfe-kernel': '^1.0.0' } },
        },
      },
    )

    const plan = planContainer(TEST_PROFILE, { containerRoot: root })

    expect(plan.shared['@acme/mfe-kernel']).toMatchObject({
      requiredVersion: '~1.0.2',
      shareScope: 'default',
    })
  })

  it('refuses a container whose framework is not installed, naming the anchor', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY }, { installed: {} })

    expect(() => planContainer(TEST_PROFILE, { containerRoot: root })).toThrowError(
      /name the acme share scope: expected @acme\/ui-runtime installed/,
    )
  })
})

describe('published Widget contract', () => {
  const WIDGET = `
import { createWidget } from '@acme/mfe-adapter'
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

  it('publishes the inputs and the events as JSON Schema', () => {
    const { fileFor } = planFixture({ 'src/mfe.ts': WIDGET })
    const descriptor = JSON.parse(fileFor('mfe-registry.json')) as {
      definitions: { contract?: Record<string, unknown> }[]
    }

    expect(descriptor.definitions[0]?.contract).toEqual({
      events: {
        title: 'alert-panel events',
        type: 'object',
        properties: {
          acknowledged: {
            type: 'object',
            properties: { alertId: { type: 'string' } },
            required: ['alertId'],
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
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
import { createWidget } from '@acme/mfe-adapter'
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

    expect(descriptor.definitions[0]?.contract).toEqual({
      events: {
        title: 'odd-panel events',
        type: 'object',
        properties: { picked: { type: 'object', properties: {}, additionalProperties: false } },
        additionalProperties: false,
      },
    })
  })

  /** `{}` is "anything" in JSON Schema: the name stays, and the provider still validates. */
  it('publishes an event whose payload is not statically readable as an unknown payload', () => {
    const { fileFor } = planFixture({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

export const oddPanel = createWidget({
  id: 'odd-panel',
  inputs: z.object({}),
  events: {
    picked: z.object({ id: z.string() }).refine(value => value.id !== ''),
    cleared: z.object({}),
  },
  render: () => null,
})
`,
    })

    const descriptor = JSON.parse(fileFor('mfe-registry.json')) as {
      definitions: { contract?: { events?: { properties?: Record<string, unknown> } } }[]
    }

    expect(descriptor.definitions[0]?.contract?.events?.properties).toEqual({
      picked: {},
      cleared: { type: 'object', properties: {}, additionalProperties: false },
    })
  })

  it('publishes no events schema when the event names are not statically readable', () => {
    const { fileFor } = planFixture({
      'src/mfe.ts': `
import { createWidget } from '@acme/mfe-adapter'
import { z } from 'zod'

const shared = { cleared: z.object({}) }

export const oddPanel = createWidget({
  id: 'odd-panel',
  inputs: z.object({}),
  events: { ...shared, picked: z.object({}) },
  render: () => null,
})
`,
    })

    const descriptor = JSON.parse(fileFor('mfe-registry.json')) as {
      definitions: { contract?: Record<string, unknown> }[]
    }

    expect(descriptor.definitions[0]?.contract).not.toHaveProperty('events')
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
import { env } from '@acme/mfe-plugin'
import { z } from 'zod'

export default {
  weird: env('WEIRD', z.custom(value => typeof value === 'string')),
}
`,
    })

    expect(() => planContainer(TEST_PROFILE, { containerRoot: root })).toThrow(/z\.custom/)
  })

  it('refuses a schema that swallows an invalid value', () => {
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/mfe.config.ts': `
import { env } from '@acme/mfe-plugin'
import { z } from 'zod'

export default { retries: env('RETRIES', z.number().catch(3)) }
`,
    })

    expect(() => planContainer(TEST_PROFILE, { containerRoot: root })).toThrow(
      /instead of reporting it/,
    )
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
import { createWidget } from '@acme/mfe-adapter'
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
import { createWidget } from '@acme/mfe-adapter'

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
import { createWidget } from '@acme/mfe-adapter'
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

  it("ignores everything it writes but the developer's runtime configuration, as it is named", () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY })
    const ignoredBy = (runtimeConfigFileName?: string): string[] => {
      const plan = planContainer(TEST_PROFILE, {
        containerRoot: root,
        ...(runtimeConfigFileName === undefined ? {} : { runtimeConfigFileName }),
      })
      const gitignore = plan.generated.files.find(file => file.path.endsWith('.gitignore'))
      return (gitignore?.contents ?? '').split('\n').filter(line => !line.startsWith('#'))
    }

    expect(ignoredBy()).toEqual(['*', '!runtime-config.json', ''])
    expect(ignoredBy('settings.json')).toEqual(['*', '!settings.json', ''])
  })
})
