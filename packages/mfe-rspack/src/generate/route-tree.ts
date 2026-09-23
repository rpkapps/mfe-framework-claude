/** The plugin and the standalone generator share these settings, so neither reverts the other. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Generator, getConfig, type Config } from '@tanstack/router-generator'

import { createBuildError } from '../diagnostics.ts'
import type { ContainerPlan } from '../plan.ts'

/**
 * A Widget-only container has no URL boundary and therefore no routes, and an Angular App
 * declares its routes as an array it passes to `createApp`, so nothing generates them.
 */
export function ownsRouteTree(plan: ContainerPlan): boolean {
  return (
    plan.framework === 'react' && plan.options.router !== false && plan.discovery.app !== undefined
  )
}

/** Build output, imported by the App entry, and never checked in. */
export function routeTreeFile(plan: ContainerPlan): string {
  return join(plan.options.containerRoot, 'src/routeTree.gen.ts')
}

/** `routeFileIgnorePattern` keeps a colocated test out of the tree: it is a file, not a URL. */
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
