/**
 * `pluginMfe()` — what a container's `rsbuild.config.ts` adds.
 *
 * It is one plugin rather than a `withMfe(config)` wrapper: an author's own
 * Rsbuild options stay theirs, and anything the plugin did not anticipate still
 * has somewhere to go. What it owns is what no author should have to write —
 * definition discovery, the generated `#mfe/*` modules, container-relative
 * asset URLs, scoped CSS, the React Compiler transform, and every Module
 * Federation setting.
 *
 * Federation reaches Rsbuild as `moduleFederation.options` rather than a
 * plugin this file registers. That is the difference that matters: declaring it
 * is what makes Rsbuild derive `output.publicPath`, `output.uniqueName` and the
 * development asset prefix for a remote, which is otherwise a container's
 * single most common way to break — its chunks resolve against the shell's
 * origin and nothing says so.
 */

import type { RsbuildPlugin } from '@rsbuild/core'

import { buildFederationOptions } from './federation/federation-options.ts'
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

        // Read once, at configuration time: which definitions a container
        // exposes and what it shares are federation settings, and Rsbuild
        // cannot apply a change to those without a restart anyway. The Rspack
        // plugin below re-reads the sources on every compilation, which is
        // what keeps the generated modules current while a dev server runs.
        const plan = planContainer({ ...options, defaultRoot: containerRoot })

        return mergeRsbuildConfig(config, {
          moduleFederation: { options: buildFederationOptions(plan) },
          // A deployed container's assets resolve against wherever it was
          // deployed, which the build cannot know — `auto` is what defers that
          // to the browser. Rsbuild's own default is the serving path, and for
          // a remote that is the *shell's*: its chunks 404, or the shell
          // answers with its own index.html and the runtime reports
          // "Unexpected token '<'".
          //
          // Development needs the opposite: an absolute URL to this
          // container's own dev server, because `auto` resolves against the
          // document and the document belongs to the shell. Rsbuild does this
          // for a config that declares federation itself, but these options
          // arrive from a plugin — after that default was decided — so the
          // plugin sets it.
          ...(api.context.action === 'build'
            ? { output: { assetPrefix: 'auto' as const } }
            : { dev: { assetPrefix: true } }),
          tools: { rspack: { plugins: [new MfeRspackPlugin(options)] } },
        })
      })
    },
  }
}
