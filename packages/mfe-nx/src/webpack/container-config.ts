/** What `withMfe()` does to the configuration Angular's builder hands it. */

import { join } from 'node:path'

import { readCachedProjectGraph, workspaceRoot } from '@nx/devkit'
import type { Configuration } from 'webpack'

import { createBuildError } from '@company/mfe-build'

import { CONTAINER_ROOT_OPTION, type MfeAngularOptions } from '../options.ts'
import { MfeWebpackPlugin } from './plugin.ts'
import type { BuilderTarget } from './with-mfe.ts'

export function addContainerPlugin(
  config: Configuration,
  options: MfeAngularOptions,
  target: BuilderTarget | undefined,
): Configuration {
  const containerRoot = options.containerRoot ?? projectRootOf(target)

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      // Angular's dev server adds its own `devServer` block; a dev server serves the developer's
      // `public/` copy, and only a build ships the declared defaults.
      new MfeWebpackPlugin(
        { ...options, containerRoot },
        { emitRuntimeConfig: !('devServer' in config) },
      ),
    ],
  }
}

/** The root of the Nx project being built, which is where its `package.json` and `src/` are. */
function projectRootOf(target: BuilderTarget | undefined): string {
  const project = target?.project
  const root =
    project === undefined ? undefined : readCachedProjectGraph().nodes[project]?.data.root

  if (root === undefined) {
    throw createBuildError({
      file: join(workspaceRoot, 'nx.json'),
      operation: 'find the container this webpack configuration builds',
      expected: 'an Nx target naming a project in the workspace graph',
      observed: project === undefined ? 'no target' : `a project '${project}' the graph lacks`,
      declaredBy: 'The Angular build integration',
      repair: `Run the build through its Nx target (nx build <project>), or pass the container directory as ${CONTAINER_ROOT_OPTION}.`,
    })
  }

  return join(workspaceRoot, root)
}
