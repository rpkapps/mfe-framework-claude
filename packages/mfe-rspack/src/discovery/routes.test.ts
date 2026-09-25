import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupContainers, createContainer } from '../testing/fixtures.ts'
import { extractRoutes } from './routes.ts'

afterEach(cleanupContainers)

function fileRoute(path: string, options = ''): string {
  return `
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

export const Route = createFileRoute('${path}')({
  ${options}
  component: () => null,
})
`
}

function routesOf(files: Readonly<Record<string, string>>) {
  const root = createContainer(files)
  return extractRoutes({ routesDirectory: join(root, 'src/routes') })
}

describe('extractRoutes', () => {
  it('writes the router’s path syntax in the neutral one', () => {
    const routes = routesOf({
      'src/routes/index.tsx': fileRoute('/'),
      'src/routes/wells.index.tsx': fileRoute('/wells/'),
      'src/routes/wells.$wellId.tsx': fileRoute('/wells/$wellId'),
      'src/routes/reports.$.tsx': fileRoute('/reports/$'),
      'src/routes/sites.{-$site}.tsx': fileRoute('/sites/{-$site}'),
      'src/routes/_auth.account.tsx': fileRoute('/_auth/account'),
      'src/routes/(admin)/users.tsx': fileRoute('/(admin)/users'),
      'src/routes/posts_.$postId.edit.tsx': fileRoute('/posts_/$postId/edit'),
    })

    expect(routes.map(route => route.path).sort()).toEqual([
      '/',
      '/account',
      '/posts/:postId/edit',
      '/reports/*',
      '/sites/:site?',
      '/users',
      '/wells',
      '/wells/:wellId',
    ])
  })

  it('leaves out a layout that adds no segment of its own', () => {
    const routes = routesOf({
      'src/routes/_auth.tsx': fileRoute('/_auth'),
      'src/routes/_auth.account.tsx': fileRoute('/_auth/account'),
    })

    expect(routes.map(route => route.path)).toEqual(['/account'])
  })

  it('reads a route’s search params, merged over its parents’ and the root’s', () => {
    const routes = routesOf({
      'src/routes/__root.tsx': `
import { createRootRouteWithContext } from '@tanstack/react-router'
import { z } from 'zod'

export const Route = createRootRouteWithContext<object>()({
  validateSearch: z.object({ lang: z.string().optional() }),
})
`,
      'src/routes/assets.tsx': fileRoute(
        '/assets',
        "validateSearch: z.object({ site: z.enum(['north', 'south']).default('north') }),",
      ),
      'src/routes/assets.$assetId.tsx': fileRoute(
        '/assets/$assetId',
        'validateSearch: z.object({ tab: z.string() }),',
      ),
    })

    const detail = routes.find(route => route.path === '/assets/:assetId')
    expect(detail?.search).toEqual({
      type: 'object',
      properties: {
        lang: { type: 'string' },
        site: { enum: ['north', 'south'], default: 'north' },
        tab: { type: 'string' },
      },
      required: ['tab'],
      // Zod strips a param a route does not declare, so the merged schema stays closed.
      additionalProperties: false,
    })
  })

  it('reads a schema through a module-level const and a validator adapter', () => {
    const routes = routesOf({
      'src/routes/wells.tsx': `
import { createFileRoute } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { z } from 'zod'

const wellSearch = z.object({ status: z.string().optional() })

export const Route = createFileRoute('/wells')({
  validateSearch: zodValidator(wellSearch),
})
`,
    })

    expect(routes[0]?.search).toMatchObject({ properties: { status: { type: 'string' } } })
  })

  it('publishes a route without search params when the build cannot read its schema', () => {
    const routes = routesOf({
      'src/routes/wells.tsx': fileRoute('/wells', 'validateSearch: buildSearchSchema(),'),
    })

    expect(routes).toEqual([{ path: '/wells' }])
  })

  it('reads nothing when there is no routes directory', () => {
    expect(routesOf({ 'src/mfe.ts': 'export {}' })).toEqual([])
  })
})
