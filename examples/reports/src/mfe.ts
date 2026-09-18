/**
 * A child App. Its contract is identical to a top-level App's: it declares its
 * own routes and reads its own URL parameters, and it does not know or care
 * whether it was mounted at /reports or at /workspace/reports.
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
