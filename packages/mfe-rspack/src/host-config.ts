/**
 * `pluginMfeHostConfig()`: runtime configuration for a host, the shell that loads containers. It
 * reads the host's `src/mfe.config.ts` as a container's is read, points `#mfe/config` at a module
 * that validates without Zod, serves the developer's `.mfe/runtime-config.json` in development and
 * ships the declared defaults in a build, which the generated `runtime-config.sh` writes the
 * deployment's environment over when the image starts (docs/decisions.md §37).
 */

import { createRequire } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import type { RsbuildPlugin } from '@rsbuild/core'

import { serveLocalRuntimeConfig } from '@company/mfe-build'

import { generateHostConfig, type HostConfigOptions } from './generate/host-config.ts'

export type { HostConfigOptions } from './generate/host-config.ts'

export const PLUGIN_MFE_HOST_CONFIG_NAME = 'mfe-host-config'

export function pluginMfeHostConfig(options: HostConfigOptions = {}): RsbuildPlugin {
  return {
    name: PLUGIN_MFE_HOST_CONFIG_NAME,

    setup(api) {
      const configuredEntries = api.getRsbuildConfig('original').source?.entry
      const entries =
        configuredEntries &&
        Object.values(configuredEntries).flatMap(value =>
          typeof value === 'string'
            ? [value]
            : Array.isArray(value)
              ? value.filter((item): item is string => typeof item === 'string')
              : value.import === undefined
                ? []
                : typeof value.import === 'string'
                  ? [value.import]
                  : value.import,
        )
      const root = options.root ?? api.context.rootPath
      const requireHost = createRequire(resolve(root, 'package.json'))
      const localEntries = entries?.filter(entry => {
        if (entry.startsWith('.') || isAbsolute(entry)) return true
        try {
          requireHost.resolve(entry)
          return false
        } catch {
          return true
        }
      })
      const hostOptions = {
        ...options,
        root,
        ...(options.entries ? {} : localEntries?.length ? { entries: localEntries } : {}),
      }
      const generation = generateHostConfig(hostOptions)
      if (generation === null) return
      const { plan } = generation

      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
        mergeRsbuildConfig(config, { resolve: { alias: { ...plan.aliases } } }),
      )

      if (plan.userContext) {
        const host = plan.userContext
        api.modifyRspackConfig(config => {
          config.module ??= {}
          config.module.rules ??= []
          config.module.rules.push({
            include: [host.source],
            enforce: 'pre',
            use: [
              {
                loader: createRequire(import.meta.url).resolve(
                  '@company/mfe-build/host-user-context-loader',
                ),
                options: {
                  root: plan.options.containerRoot,
                  entries: hostOptions.entries,
                  generatedDir: plan.options.generatedDir,
                  generator: '@company/mfe-rspack',
                },
              },
            ],
          })
        })
      }

      // Ahead of Rsbuild's own middlewares, so the single-page fallback never answers for it.
      if (plan.configSource)
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
