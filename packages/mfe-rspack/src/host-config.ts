/**
 * `pluginMfeHostConfig()`: runtime configuration for a host, the shell that loads containers. It
 * reads the host's `src/mfe.config.ts` as a container's is read, points `#mfe/config` at a module
 * that validates without Zod, serves the developer's `.mfe/runtime-config.json` in development and
 * ships the declared defaults in a build, which the generated `runtime-config.sh` writes the
 * deployment's environment over when the image starts (docs/decisions.md §37).
 */

import type { RsbuildPlugin } from '@rsbuild/core'

import { serveLocalRuntimeConfig } from '@company/mfe-build'

import { generateHostConfig, type HostConfigOptions } from './generate/host-config.ts'

export type { HostConfigOptions } from './generate/host-config.ts'

export const PLUGIN_MFE_HOST_CONFIG_NAME = 'mfe-host-config'

export function pluginMfeHostConfig(options: HostConfigOptions = {}): RsbuildPlugin {
  return {
    name: PLUGIN_MFE_HOST_CONFIG_NAME,

    setup(api) {
      const generation = generateHostConfig({
        ...options,
        root: options.root ?? api.context.rootPath,
      })
      if (generation === null) return
      const { plan } = generation

      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
        mergeRsbuildConfig(config, { resolve: { alias: { ...plan.aliases } } }),
      )

      // Ahead of Rsbuild's own middlewares, so the single-page fallback never answers for it.
      api.onBeforeStartDevServer(({ server }) => {
        server.middlewares.use(
          serveLocalRuntimeConfig({
            containerRoot: plan.options.containerRoot,
            generatedDir: plan.options.generatedDir,
            runtimeConfigFileName: plan.options.runtimeConfigFileName,
            servePath: api.getNormalizedConfig().server.base,
          }),
        )
      })

      // A build ships the declared defaults as the configuration; the deployment writes over them.
      const defaults = plan.defaults
      if (api.context.action !== 'build' || defaults?.asset === undefined) return
      const asset = defaults.asset
      api.processAssets({ stage: 'additional' }, ({ compilation, sources }) => {
        if (compilation.getAsset(asset) === undefined) {
          compilation.emitAsset(asset, new sources.RawSource(defaults.contents))
        }
      })
    },
  }
}
