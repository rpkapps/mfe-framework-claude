import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupContainers, createContainer } from '../testing/fixtures.ts'
import { generate } from './generate.ts'

afterEach(cleanupContainers)

const WIDGET_ENTRY = `
import { createWidget } from '@company/mfe-react'
import { z } from 'zod'

export const orderRow = createWidget({
  id: 'order-row',
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ acknowledged: z.object({ at: z.string() }) }),
  render: () => null,
})
`

const APP_ENTRY = `
import { createApp } from '@company/mfe-react'

import { makeRouter } from './router.ts'

export default createApp({ id: 'operations', version: '2.1.0', router: makeRouter })
`

const ROOT_ROUTE = `
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({ component: () => <Outlet /> })
`

const INDEX_ROUTE = `
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: () => null })
`

describe('mfe-generate', () => {
  it('writes the generated modules with no compiler and no bundler', async () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })

    const result = await generate(root)

    expect(result.packageName).toBe('@acme/operations')
    expect(result.diagnostics).toEqual([])
    expect(result.paths).toContain('.mfe/fetch.ts')
    expect(result.paths).toContain('.mfe/meta.ts')
    expect(result.paths).toContain('.mfe/mfe-registry.json')
    expect(readFileSync(join(root, '.mfe/meta.ts'), 'utf8')).toContain("id: 'order-row'")
  })

  it('generates the route tree an App imports, so a typecheck can resolve it', async () => {
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/routes/__root.tsx': ROOT_ROUTE,
      'src/routes/index.tsx': INDEX_ROUTE,
      // A route's colocated test is a file, not a URL, and stays out of the tree.
      'src/routes/index.test.tsx': "import { it } from 'vitest'\n\nit('renders', () => {})\n",
    })

    const result = await generate(root)

    expect(result.paths).toContain('src/routeTree.gen.ts')
    const tree = readFileSync(join(root, 'src/routeTree.gen.ts'), 'utf8')
    expect(tree).toContain('export const routeTree')
    expect(tree).not.toContain('index.test')
  })

  it('leaves a Widget-only container without a route tree', async () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })

    const result = await generate(root)

    expect(result.paths).not.toContain('src/routeTree.gen.ts')
  })

  it('reports what the build would report, rather than generating in silence', async () => {
    const root = createContainer({
      'src/mfe.ts': WIDGET_ENTRY,
      'src/logo.ts': 'export const logo = `./assets/logo.svg`\n',
    })

    const result = await generate(root)

    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.message).toContain('import.meta.url')
  })
})

describe('mfe-generate and the local runtime configuration', () => {
  const CONFIG = `
import { env } from '@company/mfe-rspack'
import { z } from 'zod'

export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
  telemetryEnabled: env('TELEMETRY_ENABLED', z.coerce.boolean().default(true)),
  pageSize: env('PAGE_SIZE', z.number().default(25)),
  mode: env('MODE', z.enum(['staging', 'production']).optional()),
}
`
  const local = (root: string): unknown =>
    JSON.parse(readFileSync(join(root, '.mfe/runtime-config.json'), 'utf8'))

  it('creates the file with the defaults and names the required fields it cannot fill', async () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY, 'src/mfe.config.ts': CONFIG })

    const result = await generate(root)

    expect(local(root)).toEqual({ telemetryEnabled: true, pageSize: 25 })
    expect(result.paths).toContain('.mfe/runtime-config.json')
    expect(result.notes).toEqual([
      '.mfe/runtime-config.json has no value for apiBaseUrl (API_BASE_URL: a string in uri form). Add one for local development; it has no default.',
    ])
  })

  it('adds only missing defaults and never changes a value already there', async () => {
    const root = createContainer({
      'src/mfe.ts': WIDGET_ENTRY,
      'src/mfe.config.ts': CONFIG,
      '.mfe/runtime-config.json':
        '{"apiBaseUrl":"http://localhost:3010/api/","telemetryEnabled":false,"extra":1}',
    })

    const result = await generate(root)

    expect(local(root)).toEqual({
      apiBaseUrl: 'http://localhost:3010/api/',
      telemetryEnabled: false,
      extra: 1,
      pageSize: 25,
    })
    expect(result.notes).toEqual([])
  })

  it('leaves a complete file untouched', async () => {
    const contents =
      '{ "apiBaseUrl": "http://localhost:3010/api/", "telemetryEnabled": false, "pageSize": 5 }'
    const root = createContainer({
      'src/mfe.ts': WIDGET_ENTRY,
      'src/mfe.config.ts': CONFIG,
      '.mfe/runtime-config.json': contents,
    })

    const result = await generate(root)

    expect(readFileSync(join(root, '.mfe/runtime-config.json'), 'utf8')).toBe(contents)
    expect(result.paths).not.toContain('.mfe/runtime-config.json')
  })

  it('leaves a file it cannot read alone and says why', async () => {
    const root = createContainer({
      'src/mfe.ts': WIDGET_ENTRY,
      'src/mfe.config.ts': CONFIG,
      '.mfe/runtime-config.json': '{ "apiBaseUrl": ',
    })

    const result = await generate(root)

    expect(readFileSync(join(root, '.mfe/runtime-config.json'), 'utf8')).toBe('{ "apiBaseUrl": ')
    expect(result.notes[0]).toContain('.mfe/runtime-config.json was left as it is:')
  })

  it('writes no local copy for a container with no configuration, and moves nothing', async () => {
    const root = createContainer({
      'src/mfe.ts': WIDGET_ENTRY,
      'public/runtime-config.json': '{ "unrelated": true }',
    })

    const result = await generate(root)

    expect(existsSync(join(root, '.mfe/runtime-config.json'))).toBe(false)
    expect(readFileSync(join(root, 'public/runtime-config.json'), 'utf8')).toBe(
      '{ "unrelated": true }',
    )
    expect(result.notes).toEqual([])
  })
})

describe('mfe-generate and a local copy left in public/', () => {
  const CONFIG = `
import { env } from '@company/mfe-rspack'
import { z } from 'zod'

export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
  pageSize: env('PAGE_SIZE', z.number().default(25)),
}
`
  const LOCAL = '{"apiBaseUrl":"http://localhost:3010/api/","pageSize":5}'

  it('moves it to .mfe/ once, byte for byte, and says how to keep it committed', async () => {
    const root = createContainer({
      'src/mfe.ts': WIDGET_ENTRY,
      'src/mfe.config.ts': CONFIG,
      'public/runtime-config.json': LOCAL,
    })

    const result = await generate(root)

    expect(existsSync(join(root, 'public/runtime-config.json'))).toBe(false)
    expect(readFileSync(join(root, '.mfe/runtime-config.json'), 'utf8')).toBe(LOCAL)
    expect(result.paths).toContain('.mfe/runtime-config.json')
    expect(result.notes).toEqual([
      'Moved public/runtime-config.json to .mfe/runtime-config.json, where the dev server now reads it and no build copies it from. ' +
        'Commit the move, and keep the file tracked: in .gitignore, ignore .mfe/* rather than .mfe/, and add !.mfe/runtime-config.json.',
    ])

    const again = await generate(root)
    expect(again.paths).toEqual([])
    expect(again.notes).toEqual([])
  })

  it('then adds the defaults the moved copy lacked', async () => {
    const root = createContainer({
      'src/mfe.ts': WIDGET_ENTRY,
      'src/mfe.config.ts': CONFIG,
      'public/runtime-config.json': '{ "apiBaseUrl": "http://localhost:3010/api/" }',
    })

    await generate(root)

    expect(JSON.parse(readFileSync(join(root, '.mfe/runtime-config.json'), 'utf8'))).toEqual({
      apiBaseUrl: 'http://localhost:3010/api/',
      pageSize: 25,
    })
  })

  it('leaves both copies when both exist, and says the one in public/ can ship', async () => {
    const kept = '{ "apiBaseUrl": "http://localhost:3020/api/", "pageSize": 10 }'
    const root = createContainer({
      'src/mfe.ts': WIDGET_ENTRY,
      'src/mfe.config.ts': CONFIG,
      'public/runtime-config.json': LOCAL,
      '.mfe/runtime-config.json': kept,
    })

    const result = await generate(root)

    expect(readFileSync(join(root, 'public/runtime-config.json'), 'utf8')).toBe(LOCAL)
    expect(readFileSync(join(root, '.mfe/runtime-config.json'), 'utf8')).toBe(kept)
    expect(result.paths).not.toContain('.mfe/runtime-config.json')
    expect(result.notes).toEqual([
      'public/runtime-config.json is no longer read: the dev server reads .mfe/runtime-config.json. ' +
        'A build copies public/ into its output, so public/runtime-config.json can now ship in production in place of the declared defaults. Delete it.',
    ])
  })
})
