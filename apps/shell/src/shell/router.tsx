/**
 * The shell's route tree.
 *
 * The shell owns the outermost routes and nothing below them. `/$appId` is the
 * boundary and `/$appId/$` is everything the mounted App routes for itself, so
 * a deep link such as `/orion-discovery/wells/42` is one shell match plus the
 * App's own routing — which is also why the dev server needs a history-API
 * fallback.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useParams,
  type AnyRoute,
} from '@tanstack/react-router'
import type { MfeRuntime } from '@company/mfe-react'

import { AppBoundary } from './app-boundary.tsx'
import { ShellLayout } from './shell-layout.tsx'

const rootRoute = createRootRoute({
  component: function ShellRoot() {
    return (
      <ShellLayout>
        <Outlet />
      </ShellLayout>
    )
  },
})

function AppBoundaryRoute() {
  // Both boundary routes share this component, so the id is read loosely
  // rather than from one of them.
  const params = useParams({ strict: false })
  return <AppBoundary appId={params.appId ?? ''} />
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$appId',
  component: AppBoundaryRoute,
})

const appSplatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$appId/$',
  component: AppBoundaryRoute,
})

export function createShellRouter(runtime: MfeRuntime) {
  /**
   * The shell has no page of its own: `/` opens the first registered
   * application. When the registry is empty or entirely quarantined there is
   * nothing to open, and the boundary's own empty state says so.
   */
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      const first = [...runtime.registry.entries.values()].find(
        entry => entry.definitionKind === 'app' && entry.hidden !== true,
      )
      if (first) throw redirect({ href: `/${first.id}`, replace: true })
    },
    component: function NoApplications() {
      return <AppBoundary appId="" />
    },
  })

  const routeTree = rootRoute.addChildren([indexRoute, appRoute, appSplatRoute] as AnyRoute[])

  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    // The mounted App renders its own error surface; a shell-level one would
    // only ever fire for a shell bug.
    scrollRestoration: true,
  })
}
