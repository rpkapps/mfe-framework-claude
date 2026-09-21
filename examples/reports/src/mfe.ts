/** A child App's contract is identical to a top-level App's: it never knows whether it was mounted
 * at /reports or at /workspace/reports. */

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
    // The shell's fallback covers an App that could not load at all, which is a different failure.
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
