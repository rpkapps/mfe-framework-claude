/** `router` is a factory called once per mount, not once per module, so two mounts get two
 * independent routers from the one generated tree (§2). */

import { createApp, type AppRouterOptions, type MfeStaticData } from '@company/mfe-react'
import { HardHatIcon } from 'lucide-react'
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

  /**
   * The framework reads four fields off a route's `staticData`: the capability pages the shell
   * opens, and the breadcrumb label. Typing TanStack's own slot with them makes a misspelt
   * capability a compile error rather than a page the shell never finds. An augmentation that
   * adds no field of its own is how one declared type is merged into another's slot;
   * respelling `MfeStaticData`'s fields here is exactly the drift it avoids.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see the comment above.
  interface StaticDataRouteOption extends MfeStaticData {}
}

export default createApp({
  id: 'operations',
  version: '2.1.0',
  description: 'Day-to-day field operations: wells, alerts and daily reports.',
  tags: ['operations'],
  icon: HardHatIcon,
  router: makeRouter,
})
