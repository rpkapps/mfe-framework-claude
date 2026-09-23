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
    expect(source).toContain("import type { InferEnvConfig } from '@company/mfe-rspack'")
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

