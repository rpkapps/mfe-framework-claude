/**
 * The App's route tree. `@tanstack/router-plugin` generates it during a build
 * and `@tanstack/router-generator` generates it outside one, and both read the
 * settings here: two configurations writing the same path would differ in
 * quoting or in which files count as routes, and every build would revert what
 * the last standalone run wrote.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Generator, getConfig, type Config } from '@tanstack/router-generator'

import { createBuildError } from '../diagnostics.ts'
import type { ContainerPlan } from '../plan.ts'

/**
 * Whether this container owns a route tree at all. A Widget-only container has
 * no URL boundary and therefore no routes, and `router: false` says the
 * container's own config already applies the router plugin.
 */
export function ownsRouteTree(plan: ContainerPlan): boolean {
  return plan.options.router !== false && plan.discovery.app !== undefined
}

/** Build output, imported by the App entry, and never checked in. */
export function routeTreeFile(plan: ContainerPlan): string {
  return join(plan.options.containerRoot, 'src/routeTree.gen.ts')
}

/**
 * `routeFileIgnorePattern` keeps a route's colocated test out of the tree: a
 * `*.test.tsx` beside the route it covers is a file, not a URL.
 */
export function routeTreeOptions(plan: ContainerPlan): Partial<Config> {
  return {
    target: 'react',
    routesDirectory: plan.options.routesDirectory,
    generatedRouteTree: routeTreeFile(plan),
    routeFileIgnorePattern: '\\.(test|spec)\\.[jt]sx?$',
    quoteStyle: 'single',
    semicolons: false,
    disableLogging: true,
    autoCodeSplitting: true,
  }
}

/** Writes `src/routeTree.gen.ts` and returns its path. */
export async function generateRouteTree(plan: ContainerPlan): Promise<string> {
  const routesDirectory = plan.options.routesDirectory

  if (!existsSync(routesDirectory)) {
    throw createBuildError({
      file: routesDirectory,
      ...(plan.discovery.app === undefined ? {} : { id: plan.discovery.app.id }),
      operation: 'generate the route tree',
      expected: 'a routes directory',
      observed: 'no such directory',
      declaredBy: 'The App contract',
      repair:
        'Create src/routes with a __root route and an index route. A container that owns no URL boundary exports Widgets instead of an App, and needs no route tree.',
    })
  }

  const config = getConfig(
    { ...routeTreeOptions(plan), ...(plan.options.router === false ? {} : plan.options.router) },
    plan.options.containerRoot,
  )

  await new Generator({ config, root: plan.options.containerRoot }).run()

  return config.generatedRouteTree
}
