/**
 * A child App. Its contract is identical to a top-level App's: it declares its
 * own routes and reads its own URL parameters, and it does not know or care
 * whether it was mounted at /reports or at /workspace/reports.
 */

import { createApp, type AppRouterOptions } from '@company/mfe-react'
import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'
import { RouteError, RouteNotFound, RoutePending } from './route-states.tsx'

function makeRouter({ basePath, history, context }: AppRouterOptions) {
  return createRouter({
    routeTree,
    basepath: basePath,
    history,
    context: { ...context },
    defaultPreload: 'intent',
    // A route that fails is this App's to present. The shell's fallback covers
    // an App that could not be loaded at all, which is a different failure.
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
    defaultPendingComponent: RoutePending,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}

export default createApp({
  id: 'reports',
  version: '1.0.0',
  router: makeRouter,
})
