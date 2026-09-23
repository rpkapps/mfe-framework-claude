/** The list is short because a setting every container must agree on is derived, not declared. */

import {
  resolveContainerPath,
  type ContainerOptions,
  type ResolvedOptions as ContainerResolvedOptions,
} from '@company/mfe-build'

export interface MfePluginOptions extends ContainerOptions {
  /** Defaults to the compiler context, the directory holding `rsbuild.config.ts`. */
  readonly containerRoot?: string
  /** Exists so a repository can run its test matrix compiled and uncompiled. */
  readonly reactCompiler?: boolean
  /** Pass `false` when the container's config already applies `@tanstack/router-plugin` first. */
  readonly router?: boolean | Readonly<Record<string, unknown>>
  /** The App's file-based routes, relative to the container root. */
  readonly routesDirectory?: string
}

/** What only a React container has: the React Compiler and TanStack Router's file routes. */
export interface ReactOptions {
  readonly routesDirectory: string
  readonly reactCompiler: boolean
  readonly router: false | Readonly<Record<string, unknown>>
}

export interface ResolvedOptions extends ContainerResolvedOptions, ReactOptions {}

const DEFAULT_ROUTES_DIRECTORY = 'src/routes'

/** `containerRoot` is the resolved one, which the routes directory is relative to. */
export function resolveReactOptions(
  options: MfePluginOptions,
  containerRoot: string,
): ReactOptions {
  return {
    routesDirectory: resolveContainerPath(
      containerRoot,
      options.routesDirectory ?? DEFAULT_ROUTES_DIRECTORY,
    ),
    reactCompiler: options.reactCompiler !== false,
    router:
      options.router === false ? false : options.router === true ? {} : (options.router ?? {}),
  }
}
