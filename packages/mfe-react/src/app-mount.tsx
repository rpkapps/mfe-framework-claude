/**
 * Mounting an App: build the boundary history, call the author's factory once,
 * validate what it returned, then render the router.
 *
 * The validation is the reason this file exists. An App that silently ignores
 * the supplied `basePath` or `history` still renders — it just renders at the
 * wrong boundary, or fights the shell over the URL, in ways that surface much
 * later and far from the cause. Checking the returned router against what was
 * supplied turns that into an explicit error at mount.
 */

import { RouterProvider, type AnyRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMfeError, type BreadcrumbItem, type NavigationBridge } from '@company/mfe-core'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import { breadcrumbsFromMatches, type BreadcrumbMatch } from './breadcrumbs-from-matches.ts'
import { createBoundaryHistory } from './boundary-history.ts'
import { MfeMountProvider } from './mount-context.tsx'
import { MfeScopeRoot } from './scope-root.tsx'
import type { AppDefinition } from './definition.ts'
import type { MfeContext, MfeRouterContext } from './router-contract.ts'
import type { MfeMount } from './runtime.ts'

/**
 * Builds the framework-owned half of the router context from a mount.
 *
 * Only `mfe` and `queryClient` are ours. The snapshot fields are read fresh
 * each time this runs so a route callback sees current values.
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

/**
 * Checks that the author's factory honoured the framework's contract.
 *
 * Every failure names which rule was broken and how to fix it, because the fix
 * is always a one-line change in the factory.
 */
export function validateAuthoredRouter(
  router: AnyRouter,
  expected: { readonly id: string; readonly version?: string; readonly basePath: string },
  supplied: { readonly history: unknown; readonly context: MfeRouterContext },
): void {
  const version = expected.version === undefined ? {} : { definitionVersion: expected.version }

  if (router.options.basepath !== expected.basePath) {
    throw createMfeError({
      code: 'app/invalid-base-path',
      id: expected.id,
      ...version,
      operation: 'mount App',
      expected: `the supplied basePath ${JSON.stringify(expected.basePath)} passed through unchanged as createRouter({ basepath })`,
      observed:
        router.options.basepath === undefined
          ? 'no basepath on the router'
          : JSON.stringify(router.options.basepath),
      declaredBy: 'The App router contract',
      repair:
        'Forward the basePath your factory received: createRouter({ basepath: basePath, … }). The framework assigns the boundary; the App does not choose it.',
    })
  }

  if (router.history !== supplied.history) {
    throw createMfeError({
      code: 'app/invalid-router',
      id: expected.id,
      ...version,
      operation: 'mount App',
      expected: 'the exact history instance the framework supplied',
      observed: 'a different history object',
      declaredBy: 'The App router contract',
      repair:
        'Forward the history your factory received: createRouter({ history, … }). Do not create, wrap, replace or mutate it — the framework owns the boundary history so no global History patch is needed.',
    })
  }

  const context = router.options.context as Record<string, unknown> | undefined

  if (!context || context['mfe'] !== supplied.context.mfe) {
    throw createMfeError({
      code: 'app/invalid-router',
      id: expected.id,
      ...version,
      operation: 'mount App',
      expected: 'the supplied context.mfe namespace, spread into the router context unchanged',
      observed: !context
        ? 'no router context'
        : context['mfe'] === undefined
          ? 'no mfe key'
          : 'a replaced or rebuilt mfe namespace',
      declaredBy: 'The framework router context contract',
      repair:
        'Spread the supplied context: createRouter({ context: { ...context, yourKey } }). Add your own top-level keys freely, but do not replace mfe or add fields inside it.',
    })
  }

  if (context['queryClient'] !== supplied.context.queryClient) {
    throw createMfeError({
      code: 'app/invalid-router',
      id: expected.id,
      ...version,
      operation: 'mount App',
      expected: 'the supplied top-level queryClient, forwarded unchanged',
      observed:
        context['queryClient'] === undefined ? 'no queryClient key' : 'a different Query client',
      declaredBy: 'The framework router context contract',
      repair:
        'Spread the supplied context rather than constructing your own Query client. The mount owns one client so nested and repeated mounts never share a cache.',
    })
  }
}

/**
 * Detects a route whose `beforeLoad` shadowed a reserved key.
 *
 * A child route returning `{ mfe: … }` merges over the framework namespace and
 * every hook below it silently reads the wrong thing, so it is reported with
 * the offending route named.
 */
function findReservedKeyConflict(
  router: AnyRouter,
  context: MfeRouterContext,
): { readonly routeId: string; readonly key: string } | null {
  for (const match of router.state.matches) {
    const matchContext = match.context as Record<string, unknown> | undefined
    if (!matchContext) continue
    if ('mfe' in matchContext && matchContext['mfe'] !== context.mfe) {
      return { routeId: match.routeId, key: 'mfe' }
    }
    if ('queryClient' in matchContext && matchContext['queryClient'] !== context.queryClient) {
      return { routeId: match.routeId, key: 'queryClient' }
    }
  }
  return null
}

function toBreadcrumbMatches(router: AnyRouter): readonly BreadcrumbMatch[] {
  return router.state.matches.map(match => {
    const route = router.routesById[match.routeId] as
      { options?: { path?: string; staticData?: unknown } } | undefined

    const head = match.meta?.find(entry => entry && 'title' in entry) as
      { title?: string } | undefined

    return {
      id: match.id,
      pathname: match.pathname,
      staticData: (match.staticData ?? route?.options?.staticData) as BreadcrumbMatch['staticData'],
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
 * Renders one App mount.
 *
 * The router is built once per mount inside a `useMemo` keyed on nothing that
 * changes, so an ordinary rerender never rebuilds it. Disposal drops the router
 * and its history; already-loaded route chunks stay in the module cache,
 * because that is a cache rather than mount state.
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

  useEffect(() => boundary.dispose, [boundary])

  useShellStateSync(router, mount, context)
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
 * Keeps route-callback snapshots current without remounting anything.
 *
 * A theme change refreshes the snapshot so a later `beforeLoad` sees it, but
 * does not invalidate loaders: a route whose data genuinely depends on theme
 * declares that dependency through the data APIs. An identity or group change
 * does invalidate, because authorization decisions and loader data made under
 * the old session are no longer valid.
 */
function useShellStateSync(router: AnyRouter, mount: MfeMount, context: MfeRouterContext): void {
  useEffect(() => {
    const { shellState } = mount.runtime

    return shellState.observeTransitions(change => {
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
  }, [router, mount, context])
}

/**
 * Publishes the App's own breadcrumb contribution and clears any override on
 * navigation.
 */
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
      const conflict = findReservedKeyConflict(router, context)
      if (conflict) {
        diagnostics.report(
          createMfeError({
            code: 'app/invalid-router',
            id: definition.id,
            operation: `merge route context for ${conflict.routeId}`,
            expected: `the reserved key "${conflict.key}" to be forwarded unchanged`,
            observed: `route ${conflict.routeId} returned its own "${conflict.key}"`,
            declaredBy: 'The framework router context contract',
            repair: `Rename the key you return from beforeLoad in ${conflict.routeId}. "mfe" and "queryClient" are reserved; every other top-level name is yours.`,
          }),
        )
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
