/** It contributes configuration and never replaces it, so an author's options stay theirs (§13). */

import type { RsbuildPlugin } from '@rsbuild/core'

import {
  buildFederationOptions,
  containerPostcssPlugins,
  serveLocalRuntimeConfig,
} from '@company/mfe-build'

import { loadScopePlugin } from './css/scope.ts'
import type { MfePluginOptions } from './options.ts'
import { createContainerPlanner } from './plan.ts'
import { MfeRspackPlugin } from './plugin.ts'

export const PLUGIN_MFE_NAME = 'mfe'

export function pluginMfe(options: MfePluginOptions = {}): RsbuildPlugin {
  return {
    name: PLUGIN_MFE_NAME,

    setup(api) {
      const containerRoot = options.containerRoot ?? api.context.rootPath

      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
        // Read once at configuration time, because Rsbuild cannot apply a change to what a
        // container exposes or shares without a restart; the Rspack plugin re-plans the sources
        // before every compile after the first, with the same planner.
        const replan = createContainerPlanner({ ...options, containerRoot })
        const plan = replan()

        // Rsbuild's federation plugin applies its defaults only to a config that declares
        // `moduleFederation.options` before a plugin's arrive, so these three are repeated (§13).
        const original = api.getRsbuildConfig('original')

        const isBuild = api.context.action === 'build'

        return mergeRsbuildConfig(config, {
          moduleFederation: { options: buildFederationOptions(plan) },
          server: {
            // A remote is read cross-origin by a shell, always.
            ...(original.server?.cors === undefined ? { cors: true } : {}),
            // The shell's registry names this port; falling back to another hides the container.
            ...(original.server?.strictPort === undefined ? { strictPort: true } : {}),
          },
          // Rsbuild's default asset prefix is the serving path, which for a remote is the
          // *shell's*; development instead needs this container's own dev server (§13).
          ...(isBuild
            ? { output: { assetPrefix: 'auto' as const } }
            : {
                dev: {
                  ...(original.dev?.assetPrefix === undefined ? { assetPrefix: true } : {}),
                  // The hot-update client reads the page's location, which belongs to the shell.
                  ...(original.dev?.client?.port === undefined && config.server?.port !== undefined
                    ? { client: { port: config.server.port } }
                    : {}),
                },
              }),
          // Nothing ever requests a container's application entry, so building it is dead weight.
          ...(original.source?.entry === undefined
            ? { source: { entry: { index: plan.entryStub } } }
            : {}),
          tools: {
            // The stylesheet is generated, so no author's PostCSS config would compile it.
            postcss: (postcss, { addPlugins }) => {
              addPlugins(
                containerPostcssPlugins({
                  scopes: plan.scopes,
                  containerRoot: plan.options.containerRoot,
                  loadScopePlugin,
                  tailwind: plan.tailwind,
                  configured: postcss.postcssOptions,
                }),
              )
            },
            rspack: {
              plugins: [new MfeRspackPlugin(plan, replan, { emitRuntimeConfig: isBuild })],
            },
          },
        })
      })

      // The developer's own values, from `.mfe/`, where no build copies them from. Registered
      // ahead of Rsbuild's own middlewares, so a copy left in `public/` is never the one served.
      api.onBeforeStartDevServer(({ server }) => {
        server.middlewares.use(
          serveLocalRuntimeConfig({
            ...options,
            containerRoot,
            servePath: api.getNormalizedConfig().server.base,
          }),
        )
      })
    },
  }
}
