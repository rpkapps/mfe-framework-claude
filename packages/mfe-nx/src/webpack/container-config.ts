/** What `withMfe()` does to the configuration Angular's builder hands it. */

import { join } from 'node:path'

import { readCachedProjectGraph, workspaceRoot } from '@nx/devkit'
import type { Configuration } from 'webpack'

import {
  createBuildError,
  serveLocalRuntimeConfig,
  type DevServerMiddleware,
  type LocalRuntimeConfigOptions,
} from '@company/mfe-build'

import { CONTAINER_ROOT_OPTION, type MfeAngularOptions } from '../options.ts'
import { MfeWebpackPlugin } from './plugin.ts'
import type { BuilderTarget } from './with-mfe.ts'

export function addContainerPlugin(
  config: Configuration,
  options: MfeAngularOptions,
  target: BuilderTarget | undefined,
): Configuration {
  const containerRoot = options.containerRoot ?? projectRootOf(target)
  // Only Angular's dev server hands over a `devServer`; a build has none to add to.
  const { devServer } = config as ServedConfiguration

  const configured: ServedConfiguration = {
    ...config,
    ...(devServer === undefined || devServer === false
      ? {}
      : { devServer: withLocalRuntimeConfig(devServer, { ...options, containerRoot }) }),
    plugins: [...(config.plugins ?? []), new MfeWebpackPlugin({ ...options, containerRoot })],
  }
  return configured
}

/** webpack's own types leave `devServer` to webpack-dev-server, which this never imports. */
type ServedConfiguration = Configuration & { readonly devServer?: AngularDevServer | false }

/** The part of the webpack-dev-server configuration Angular builds that this reads. */
interface AngularDevServer {
  readonly devMiddleware?: { readonly publicPath?: string }
  readonly setupMiddlewares?: SetupMiddlewares
}

type SetupMiddlewares = (middlewares: MiddlewareEntry[], server: unknown) => MiddlewareEntry[]

/** An entry of webpack-dev-server's middleware list: a named one, or a bare handler. */
type MiddlewareEntry =
  { readonly name?: string; readonly middleware: unknown } | DevServerMiddleware

/** webpack-dev-server's name for the middleware that serves the compiled output. */
const COMPILED_OUTPUT_MIDDLEWARE = 'webpack-dev-middleware'

/**
 * The developer's own values, from `.mfe/`, where no build copies them from. The server's host
 * checks and headers run first; the compiled output, where Angular serves its copy of `public/`
 * from, runs after, so a copy left in `public/` is never the one served. An author's own
 * `setupMiddlewares` still runs, before this is placed.
 */
function withLocalRuntimeConfig(
  devServer: AngularDevServer,
  options: LocalRuntimeConfigOptions,
): AngularDevServer {
  const middleware = serveLocalRuntimeConfig({
    ...options,
    servePath: devServer.devMiddleware?.publicPath,
  })
  const configured = devServer.setupMiddlewares

  return {
    ...devServer,
    setupMiddlewares: (middlewares, server) => {
      const all = configured === undefined ? middlewares : configured(middlewares, server)
      const compiled = all.findIndex(
        entry => typeof entry !== 'function' && entry.name === COMPILED_OUTPUT_MIDDLEWARE,
      )
      const at = compiled === -1 ? 0 : compiled
      return [
        ...all.slice(0, at),
        { name: 'mfe-local-runtime-config', middleware },
        ...all.slice(at),
      ]
    },
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
