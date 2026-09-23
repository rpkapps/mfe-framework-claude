/**
 * `withMfe()` is what a container's `customWebpackConfig` exports. `@nx/angular:webpack-browser`
 * and `@nx/angular:dev-server` `require()` that file and await the function it exports, called
 * with the configuration Angular built, so this contributes one plugin and replaces nothing an
 * author wrote.
 */

import type { Configuration } from 'webpack'

import type { MfeAngularOptions } from '../options.ts'

/** The Nx target the builder was run for, which it passes as the third argument. */
export interface BuilderTarget {
  readonly project?: string
  readonly target?: string
  readonly configuration?: string
}

export type CustomWebpackConfig = (
  config: Configuration,
  builderOptions?: unknown,
  target?: BuilderTarget,
) => Promise<Configuration>

export function withMfe(options: MfeAngularOptions = {}): CustomWebpackConfig {
  return async (config, _builderOptions, target) => {
    // Deferred until the builder calls this: it `require()`s the config file with a CommonJS
    // TypeScript transpiler registered, and that transpiler also rewrites any linked package the
    // file loads, which breaks the neutral build's ES modules. By the time the builder calls the
    // function the transpiler is unregistered and Node loads them as they are.
    const { addContainerPlugin } = await import('./container-config.ts')
    return addContainerPlugin(config, options, target)
  }
}
