import { readFileSync } from 'node:fs'
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
  inputs: z.object({ orderId: z.string() }),
  events: { acknowledged: z.object({ at: z.string() }) },
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
