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
  it('writes the router’s path syntax in the neutral one, leaving out a parameter within a segment', () => {
    const routes = routesOf({
      'src/routes/index.tsx': fileRoute('/'),
      'src/routes/wells.index.tsx': fileRoute('/wells/'),
      'src/routes/wells.$wellId.tsx': fileRoute('/wells/$wellId'),
      'src/routes/reports.$.tsx': fileRoute('/reports/$'),
      'src/routes/sites.{-$site}.tsx': fileRoute('/sites/{-$site}'),
      'src/routes/_auth.account.tsx': fileRoute('/_auth/account'),
      'src/routes/(admin)/users.tsx': fileRoute('/(admin)/users'),
      'src/routes/posts_.$postId.edit.tsx': fileRoute('/posts_/$postId/edit'),
      'src/routes/logs.{$logId}.tsx': fileRoute('/logs/{$logId}'),
      'src/routes/files.{$}.tsx': fileRoute('/files/{$}'),
      'src/routes/exports.{$exportId}.json.tsx': fileRoute('/exports/{$exportId}.json'),
      'src/routes/sheets.v{-$version}.tsx': fileRoute('/sheets/v{-$version}'),
    })

    expect(routes.map(route => route.path).sort()).toEqual([
      '/',
      '/account',
      '/files/*',
      '/logs/:logId',
      '/posts/:postId/edit',
      '/reports/*',
      '/sites/:site?',
      '/users',
      '/wells',
      '/wells/:wellId',
    ])
  })

  it('publishes an index route inside a pathless layout or a group, at its parent’s path', () => {
    const routes = routesOf({
      'src/routes/_auth.tsx': fileRoute('/_auth'),
      'src/routes/_auth.index.tsx': fileRoute('/_auth/'),
      'src/routes/(admin)/route.tsx': fileRoute('/(admin)'),
      'src/routes/(admin)/settings/index.tsx': fileRoute('/(admin)/settings/'),
    })

    expect(routes.map(route => route.path).sort()).toEqual(['/', '/settings'])
  })

  it('reads no route out of a colocated test or a `-` directory, as the route tree does not', () => {
    const routes = routesOf({
      'src/routes/wells.tsx': fileRoute('/wells'),
      'src/routes/wells.test.tsx': fileRoute('/wells-under-test'),
      'src/routes/-components/card.tsx': fileRoute('/card'),
    })

    expect(routes.map(route => route.path)).toEqual(['/wells'])
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

  it('merges a layout’s search params into its index route, and an index route’s into none', () => {
    const routes = routesOf({
      'src/routes/_auth.tsx': fileRoute(
        '/_auth',
        'validateSearch: z.object({ token: z.string() }),',
      ),
      'src/routes/_auth.index.tsx': fileRoute(
        '/_auth/',
        'validateSearch: z.object({ tab: z.string() }),',
      ),
      'src/routes/_auth.account.tsx': fileRoute('/_auth/account'),
    })

    const properties = (path: string) =>
      Object.keys(routes.find(route => route.path === path)?.search?.['properties'] ?? {})
    expect(properties('/')).toEqual(['token', 'tab'])
    expect(properties('/account')).toEqual(['token'])
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
