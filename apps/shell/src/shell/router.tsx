/**
 * The shell owns the outermost routes and nothing below them, so the dev server needs a
 * history-API fallback. `/` is the only path the shell can claim without shadowing an App,
 * because a definition id is lower-case letters, digits and hyphens. No component is defined
 * here: a module that exports a factory is not a React Refresh boundary (§18).
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type AnyRoute,
} from '@tanstack/react-router'

import { AppBoundary } from './boundary.tsx'
import { ShellLayout } from './chrome.tsx'
import { DashboardPage } from './dashboard/page.tsx'

const rootRoute = createRootRoute({
  component: () => (
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  ),
})

export function createShellRouter() {
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage }),
    createRoute({ getParentRoute: () => rootRoute, path: '/$appId', component: AppBoundary }),
    createRoute({ getParentRoute: () => rootRoute, path: '/$appId/$', component: AppBoundary }),
  ] as AnyRoute[])

  return createRouter({ routeTree, defaultPreload: 'intent' })
}
