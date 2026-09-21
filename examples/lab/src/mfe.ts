/** `router` is a factory called once per mount, not once per module, so two mounts get two
 * independent routers from the one generated tree (§2). */

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
    // Freshness is Query's decision for data it caches, so the two caches do not compete.
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}

export default createApp({
  id: 'lab',
  version: '1.0.0',
  router: makeRouter,
})
