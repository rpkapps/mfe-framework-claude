/**
 * An Angular App's routes, read out of the routes array `createApp` receives, so the shell knows
 * every path the App serves before the App is loaded. Angular's paths already use the neutral
 * syntax (`:id`); Angular's router declares no search params, so none are published.
 */

import {
  objectProperty,
  stringLiteralValue,
  ts,
  unwrapExpression,
  walk,
  type ContainerProfile,
  type PublishedRoute,
} from '@company/mfe-build'

import { resolveAppRoutes } from './route-data.ts'

/** The properties that make a route a destination rather than only a parent or a redirect. */
const DESTINATION_PROPERTIES = ['component', 'loadComponent', 'loadChildren'] as const

/**
 * Every route with a component, reached from the array `createApp` receives through inline
 * `children: [ … ]`. A route whose path is not a literal is left out with everything below it, as
 * are redirects and the `**` catch-all; routes behind `loadChildren` are the lazy module's, which
 * the build does not follow, so only the route that loads them is published.
 */
export const readAngularRoutes: NonNullable<ContainerProfile['readRoutes']> = context => {
  const appRoutes = resolveAppRoutes(context.entryFile, context.sources)
  if ('unresolved' in appRoutes) return []

  const sourceFile = context.sources.parse(appRoutes.file)
  let array: ts.ArrayLiteralExpression | undefined
  walk(sourceFile, node => {
    if (
      ts.isArrayLiteralExpression(node) &&
      node.pos === appRoutes.pos &&
      node.end === appRoutes.end
    ) {
      array = node
    }
  })
  if (array === undefined) return []

  const routes: PublishedRoute[] = []
  collect(array, [], routes)
  return routes
}

function collect(
  array: ts.ArrayLiteralExpression,
  parents: readonly string[],
  routes: PublishedRoute[],
): void {
  for (const element of array.elements) {
    const route = unwrapExpression(element)
    if (!ts.isObjectLiteralExpression(route)) continue

    const pathProperty = objectProperty(route, 'path')
    const path = pathProperty === undefined ? '' : stringLiteralValue(pathProperty.initializer)
    if (path === null || path === '**' || objectProperty(route, 'redirectTo') !== undefined) {
      continue
    }

    const segments = [...parents, ...path.split('/').filter(segment => segment !== '')]
    if (DESTINATION_PROPERTIES.some(name => objectProperty(route, name) !== undefined)) {
      routes.push({ path: `/${segments.join('/')}` })
    }

    const children = objectProperty(route, 'children')
    const inline = children === undefined ? undefined : unwrapExpression(children.initializer)
    if (inline !== undefined && ts.isArrayLiteralExpression(inline))
      collect(inline, segments, routes)
  }
}
