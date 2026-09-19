/**
 * Mounting an App: build the boundary history, call the author's factory once,
 * validate what it returned, then render the router.
 *
 * The validation is the reason this file exists. An App that ignores the
 * supplied `basePath` or `history` still renders — at the wrong boundary, or
 * fighting the shell over the URL — in ways that surface far from the cause.
 */

import { RouterProvider, type AnyRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMfeError,
  createMfeErrorFactory,
  DEV,
  type BreadcrumbItem,
  type NavigationBridge,
} from '@company/mfe-core'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import { breadcrumbsFromMatches, type BreadcrumbMatch } from './breadcrumbs-from-matches.ts'
import { createBoundaryHistory } from './boundary-history.ts'
import { MfeMountProvider } from './mount-context.tsx'
import { MfeScopeRoot } from './scope-root.tsx'
import { useRouterBlockerBridge } from './router-blockers.ts'
import type { AppDefinition } from './definition.ts'
import type { MfeContext, MfeRouterContext } from './router-contract.ts'
import type { MfeMount } from './runtime.ts'

/**
 * Only `mfe` and `queryClient` are ours. The snapshot fields are read fresh each
 * time this runs, so a route callback sees current values.
 */
export function createRouterContext(mount: MfeMount): MfeRouterContext {
  const shellState = mount.runtime.shellState.getSnapshot()

  const mfe: MfeContext = Object.freeze({
    user: shellState.user,
    groups: shellState.groups,
    theme: shellState.theme,
    telemetry: mount.telemetry,
    storage: mount.storage,
    signal: mount.signal,
  })

  return Object.freeze({ mfe, queryClient: mount.queryClient })
}

/** Every failure names the rule that was broken; the fix is a one-line factory change. */
function validateAuthoredRouter(
  router: AnyRouter,
  expected: { readonly id: string; readonly version?: string; readonly basePath: string },
  supplied: { readonly history: unknown; readonly context: MfeRouterContext },
): void {
  const fail = createMfeErrorFactory({
    id: expected.id,
    ...(expected.version === undefined ? {} : { definitionVersion: expected.version }),
    operation: 'mount App',
  })

  if (router.options.basepath !== expected.basePath) {
    throw fail({
      code: 'app/invalid-base-path',
      expected: `the supplied basePath ${JSON.stringify(expected.basePath)} passed through unchanged as createRouter({ basepath })`,
      observed:
        router.options.basepath === undefined
          ? 'no basepath on the router'
          : JSON.stringify(router.options.basepath),
      repair:
        'Forward the basePath your factory received: createRouter({ basepath: basePath, … }).',
    })
  }

  if (router.history !== supplied.history) {
    throw fail({
      code: 'app/invalid-router',
      expected: 'the exact history instance the framework supplied',
      observed: 'a different history object',
      repair:
        'Do not create, wrap, replace or mutate the history; forward the one your factory received.',
    })
  }

  const context = router.options.context as Record<string, unknown> | undefined

  if (!context || context['mfe'] !== supplied.context.mfe) {
    throw fail({
      code: 'app/invalid-router',
      expected: 'the supplied context.mfe namespace, spread into the router context unchanged',
      observed: !context
        ? 'no router context'
        : context['mfe'] === undefined
          ? 'no mfe key'
          : 'a replaced or rebuilt mfe namespace',
      repair:
        'Spread the supplied context: add your own top-level keys freely, but do not replace mfe or add fields inside it.',
    })
  }

  if (context['queryClient'] !== supplied.context.queryClient) {
    throw fail({
      code: 'app/invalid-router',
      expected: 'the supplied top-level queryClient, forwarded unchanged',
      observed:
        context['queryClient'] === undefined ? 'no queryClient key' : 'a different Query client',
      repair:
        'Spread the supplied context rather than constructing your own Query client; the mount owns one.',
    })
  }
}

/**
 * A child route returning `{ mfe: … }` merges over the framework namespace and
 * every hook below it silently reads the wrong thing, so the offending route is
 * named rather than left to be discovered.
 */
function findReservedKeyConflict(
  router: AnyRouter,
  context: MfeRouterContext,
): { readonly routeId: string; readonly key: string } | null {
  for (const match of router.state.matches) {
    // `AnyRouter` types `routeId` as `any`.
    const routeId = String(match.routeId)
    const matchContext = match.context as unknown as Record<string, unknown> | undefined
    if (!matchContext) continue
    if ('mfe' in matchContext && matchContext['mfe'] !== context.mfe) {
      return { routeId, key: 'mfe' }
    }
    if ('queryClient' in matchContext && matchContext['queryClient'] !== context.queryClient) {
      return { routeId, key: 'queryClient' }
    }
  }
  return null
}

function toBreadcrumbMatches(router: AnyRouter): readonly BreadcrumbMatch[] {
  return router.state.matches.map(match => {
    const route = router.routesById[String(match.routeId)] as
      { options?: { path?: string; staticData?: unknown } } | undefined

    const head = match.meta?.find(entry => entry && 'title' in entry) as
      { title?: string } | undefined

    return {
      id: match.id,
      pathname: match.pathname,
      staticData: match.staticData ?? route?.options?.staticData,
      routePath: route?.options?.path,
      title: head?.title,
      params: match.params as Readonly<Record<string, string>> | undefined,
    }
  })
}

export interface AppMountProps {
  readonly definition: AppDefinition
  readonly mount: MfeMount
  readonly bridge: NavigationBridge
}

/**
 * The router is built once per mount, so an ordinary rerender never rebuilds it.
 * Disposal drops the router and its history; already-loaded route chunks stay in
 * the module cache, because that is a cache rather than mount state.
 */
export function AppMount({ definition, mount, bridge }: AppMountProps): ReactNode {
  const boundary = useMemo(() => createBoundaryHistory(bridge), [bridge])

  const { router, context } = useMemo(() => {
    const routerContext = createRouterContext(mount)
    const created = definition.createRouter({
      basePath: mount.basePath,
      history: boundary.history,
      context: routerContext,
    })

    validateAuthoredRouter(
      created,
      {
        id: definition.id,
        ...(definition.version === undefined ? {} : { version: definition.version }),
        basePath: mount.basePath,
      },
      { history: boundary.history, context: routerContext },
    )

    return { router: created, context: routerContext }
  }, [definition, mount, boundary])

  /*
   * The bridge subscription is owned by the effect that ends it, not by the
   * memo above. React tears an effect down and sets it up again without
   * re-running that memo — StrictMode does it on every mount in development —
   * and a history that subscribed at construction was therefore left deaf from
   * the first cleanup onwards: the URL moved on a browser back and the App's
   * router was never told, so the address bar and the page disagreed.
   */
  useEffect(() => boundary.attach(), [boundary])

  // The App's own `useBlocker` registrations, extended to the navigations the
  // shell performs. Nothing in the author's router knows this is happening.
  useRouterBlockerBridge(boundary, mount)

  useShellStateSync(router, mount)
  useBreadcrumbContribution(router, mount, definition, context)

  return (
    <MfeMountProvider mount={mount}>
      <QueryClientProvider client={mount.queryClient}>
        <MfeScopeRoot definitionId={definition.id} mountToken={mount.mountToken} kind="app">
          <RouterProvider router={router} />
        </MfeScopeRoot>
      </QueryClientProvider>
    </MfeMountProvider>
  )
}

/**
 * A theme change refreshes the snapshot so a later `beforeLoad` sees it but does
 * not invalidate loaders; an identity or group change does, because decisions
 * and loader data made under the old session are no longer valid.
 */
function useShellStateSync(router: AnyRouter, mount: MfeMount): void {
  useEffect(() => {
    return mount.runtime.shellState.observeTransitions(change => {
      const current = router.options.context as Record<string, unknown> | undefined
      const next = createRouterContext(mount)

      // Author-added top-level keys must survive a framework context update.
      router.update({
        ...router.options,
        context: { ...current, mfe: next.mfe, queryClient: next.queryClient },
      })

      const invalidates = change.transitions.some(
        transition => transition.kind === 'identity' || transition.kind === 'groups',
      )
      if (invalidates) void router.invalidate()
    })
  }, [router, mount])
}

/** Publishes the App's own contribution and clears any override on navigation. */
function useBreadcrumbContribution(
  router: AnyRouter,
  mount: MfeMount,
  definition: AppDefinition,
  context: MfeRouterContext,
): void {
  const lastPathname = useRef<string | null>(null)

  useEffect(() => {
    if (!definition.contributesBreadcrumbs) return undefined

    const { breadcrumbs, diagnostics } = mount.runtime
    const handle = breadcrumbs.registerMount(definition.id, mount.mountToken, mount.depth)

    const publish = (): void => {
      // A development diagnostic, so the scan over every match on every
      // navigation — and the sentences it would write — leave the production
      // build entirely rather than running to report nothing.
      if (DEV) {
        const conflict = findReservedKeyConflict(router, context)
        if (conflict) {
          diagnostics.report(
            createMfeError({
              code: 'app/invalid-router',
              id: definition.id,
              operation: `merge route context for ${conflict.routeId}`,
              expected: `the reserved key "${conflict.key}" to be forwarded unchanged`,
              observed: `route ${conflict.routeId} returned its own "${conflict.key}"`,
              repair: `Rename the key you return from beforeLoad in ${conflict.routeId}.`,
            }),
          )
        }
      }

      const pathname = router.state.location.pathname
      if (lastPathname.current !== null && lastPathname.current !== pathname) {
        breadcrumbs.notifyNavigation(mount.mountToken)
      }
      lastPathname.current = pathname

      const items: readonly BreadcrumbItem[] = breadcrumbsFromMatches(toBreadcrumbMatches(router))
      handle.update(items)
    }

    publish()
    const unsubscribe = router.subscribe('onResolved', publish)

    return () => {
      unsubscribe()
      handle.remove()
    }
  }, [router, mount, definition, context])
}
