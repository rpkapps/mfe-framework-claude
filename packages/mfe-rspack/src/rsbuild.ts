/** It contributes configuration and never replaces it, so an author's options stay theirs (§13). */

import type { RsbuildConfig, RsbuildPlugin } from '@rsbuild/core'

import { buildFederationOptions, containerPostcssPlugins } from '@company/mfe-build'

import { loadScopePlugin } from './css/scope.ts'
import type { MfePluginOptions } from './options.ts'
import { planContainer } from './plan.ts'
import { MfeRspackPlugin } from './plugin.ts'

export const PLUGIN_MFE_NAME = 'mfe'

export function pluginMfe(options: MfePluginOptions = {}): RsbuildPlugin {
  return {
    name: PLUGIN_MFE_NAME,

    setup(api) {
      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
        const containerRoot = options.containerRoot ?? api.context.rootPath

        // Read once at configuration time, because Rsbuild cannot apply a change to what a
        // container exposes or shares without a restart; the Rspack plugin re-reads per build.
        const plan = planContainer({ ...options, defaultRoot: containerRoot })

        // Rsbuild's federation plugin applies its defaults only to a config that declares
        // `moduleFederation.options` before a plugin's arrive, so these three are repeated (§13).
        const original = api.getRsbuildConfig('original')

        const isBuild = api.context.action === 'build'

        const merged = mergeRsbuildConfig(config, {
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
                  configured: postcss.postcssOptions,
                }),
              )
            },
            rspack: { plugins: [new MfeRspackPlugin(options, { emitRuntimeConfig: isBuild })] },
          },
        })

        // The build ships the declared defaults instead; a developer's `public/` copy would
        // otherwise overwrite them with local values, like a localhost API.
        if (isBuild && plan.configSource !== undefined) {
          merged.server = {
            ...merged.server,
            publicDir: withoutRuntimeConfig(
              merged.server?.publicDir,
              plan.options.runtimeConfigFileName,
            ),
          }
        }
        return merged
      })
    },
  }
}

type PublicDir = NonNullable<NonNullable<RsbuildConfig['server']>['publicDir']>

/** Rsbuild reads `ignore` relative to each public directory, and fills in the default name. */
function withoutRuntimeConfig(publicDir: PublicDir | undefined, fileName: string): PublicDir {
  if (publicDir === false) return false
  const ignore = (entry: { readonly ignore?: string[] } | undefined) => ({
    ...entry,
    ignore: [...(entry?.ignore ?? []), fileName],
  })
  if (Array.isArray(publicDir)) return publicDir.map(entry => ignore(entry))
  return ignore(publicDir)
}
