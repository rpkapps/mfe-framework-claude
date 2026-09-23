/**
 * Derives an App's breadcrumb contribution from its activated routes; label resolution is a fixed
 * order rather than an inference over whatever a resolver happens to return.
 */

import { NavigationEnd, type ActivatedRouteSnapshot, type Router } from '@angular/router'
import type { BreadcrumbItem, Unsubscribe } from '@company/mfe-core'
import { humanizeSegment, withCurrentLast, type MountContext } from '@company/mfe-runtime'
import { filter } from 'rxjs'

import { MFE_ROUTE_DATA, type MfeRouteData } from './route-data.ts'

/** Parameters whose names carry no meaning worth showing to a user. */
const GENERIC_PARAM_NAMES = new Set(['id'])

/**
 * Read from the route's own declaration: the router copies a componentless parent's data and title
 * into its children, which would label every child with its parent's crumb.
 */
function routeDataOf(route: ActivatedRouteSnapshot): MfeRouteData | undefined {
  const data: unknown = route.routeConfig?.data?.[MFE_ROUTE_DATA]
  return data !== null && typeof data === 'object' ? data : undefined
}

function resolveLabel(route: ActivatedRouteSnapshot, path: string): string | null {
  const explicit = routeDataOf(route)?.breadcrumb
  if (explicit === false) return null
  if (typeof explicit === 'string') return explicit

  // The resolved title, whether the route declared a string or a resolver.
  if (route.routeConfig?.title !== undefined && route.title !== undefined && route.title !== '') {
    return route.title
  }

  const segment = path.split('/').filter(Boolean).pop()
  if (segment === undefined) return null

  if (segment.startsWith(':')) {
    const name = segment.slice(1)
    // A generic parameter renders nothing rather than showing a raw id.
    if (name === '' || GENERIC_PARAM_NAMES.has(name)) return null
    const value: unknown = route.params[name]
    return typeof value === 'string' ? value : humanizeSegment(name)
  }

  return humanizeSegment(segment)
}

function joinPath(basePath: string, segments: readonly string[]): string {
  const base = basePath.replace(/\/+$/, '')
  return segments.length === 0 ? base || '/' : `${base}/${segments.join('/')}`
}

/**
 * Walks the primary chain from the root. Empty-path and wildcard routes are layout and fallbacks,
 * so they never contribute; the deepest contributing route is the current one. Items are frozen so
 * the store can compare by content and keep unchanged records by reference.
 */
export function breadcrumbsFromSnapshot(
  root: ActivatedRouteSnapshot,
  basePath: string,
): readonly BreadcrumbItem[] {
  const items: BreadcrumbItem[] = []
  const segments: string[] = []

  for (let route = root.firstChild; route !== null; route = route.firstChild) {
    segments.push(...route.url.map(segment => segment.path))

    const path = route.routeConfig?.path
    if (path === undefined || path === '' || path === '**') continue

    const label = resolveLabel(route, path)
    if (label === null) continue

    const href = joinPath(basePath, segments)
    items.push(Object.freeze({ key: href, label, href }))
  }

  return withCurrentLast(items)
}

/**
 * Publishes the App's own contribution after every completed navigation, and tells the store when
 * the path changed so an override a multi-step flow installed cannot leak into the next route.
 */
export function contributeBreadcrumbs(
  router: Router,
  context: MountContext,
  definitionId: string,
): Unsubscribe {
  const { breadcrumbs } = context.runtime
  const contribution = breadcrumbs.registerMount(definitionId, context.mountToken, context.depth)
  let lastPath: string | null = null

  const subscription = router.events
    .pipe(filter(event => event instanceof NavigationEnd))
    .subscribe(event => {
      // A changed query or fragment is the same page, so it keeps a flow's override.
      const path = event.urlAfterRedirects.split(/[?#]/, 1)[0] ?? ''
      if (lastPath !== null && lastPath !== path) breadcrumbs.notifyNavigation(context.mountToken)
      lastPath = path
      contribution.update(
        breadcrumbsFromSnapshot(router.routerState.snapshot.root, context.basePath),
      )
    })

  return () => {
    subscription.unsubscribe()
    contribution.remove()
  }
}
