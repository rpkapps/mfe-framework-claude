/**
 * The shell owns the outermost routes and nothing below them.
 *
 * `/` is the shell's own page — the widget dashboard, the one surface the shell
 * composes itself. `/$appId` is the boundary; `/$appId/$` is everything the
 * mounted App routes for itself, which is why the dev server needs a
 * history-API fallback.
 *
 * A registered App is reached at `/<its id>`, and a definition id is lower-case
 * letters, digits and hyphens — so `/` is the only path the shell can claim
 * without shadowing an App that might one day be called that.
 *
 * No component is defined here. The router is built once per page and a module
 * that exports a factory is not a React Refresh boundary, so keeping the
 * components in their own modules is what lets an edit to the chrome hot-update
 * instead of reloading the page.
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

/**
 * The router takes no runtime. It used to, for an index route that redirected
 * to whichever App happened to be registered first — a page whose address
 * depended on the registry, and which had nothing to show when every entry was
 * quarantined. `/` is now the shell's own page, so the routes are static.
 */
export function createShellRouter() {
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage }),
    createRoute({ getParentRoute: () => rootRoute, path: '/$appId', component: AppBoundary }),
    createRoute({ getParentRoute: () => rootRoute, path: '/$appId/$', component: AppBoundary }),
  ] as AnyRoute[])

  return createRouter({ routeTree, defaultPreload: 'intent' })
}
