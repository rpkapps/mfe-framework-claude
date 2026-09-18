/**
 * An App: a routable, independently deployable product surface.
 *
 * This whole file is the framework-specific part of an App. Everything else in
 * this project is ordinary TanStack Router, React and Query.
 *
 * The factory runs once per mount, not once per module, so an App mounted twice
 * gets two routers and disposal drops the router rather than reusing a
 * module-scope singleton. `basePath`, `history` and `context` are passed
 * straight through; the framework validates that at mount.
 */

import { createApp, type AppRouterOptions } from '@company/mfe-react'
import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

function makeRouter({ basePath, history, context }: AppRouterOptions) {
  return createRouter({
    routeTree,
    basepath: basePath,
    history,
    context: { ...context },
    defaultPreload: 'intent',
    // Route preloading defers freshness decisions to Query for data it caches,
    // so the two caches do not compete.
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}

export default createApp({
  id: 'operations',
  version: '2.1.0',
  router: makeRouter,
})
