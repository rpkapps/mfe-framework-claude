/**
 * `pluginMfe()` — what a container's `rsbuild.config.ts` adds.
 *
 * It is one plugin rather than a `withMfe(config)` wrapper: an author's own
 * Rsbuild options stay theirs, and anything the plugin did not anticipate still
 * has somewhere to go. What it owns is what no author should have to write —
 * definition discovery, the generated `#mfe/*` modules and the stylesheet
 * beside them, container-relative asset URLs, the PostCSS pipeline that
 * compiles and scopes that stylesheet, the React Compiler transform, and every
 * Module Federation setting.
 *
 * Federation reaches Rsbuild as `moduleFederation.options` rather than a
 * plugin this file registers. That is the difference that matters: declaring it
 * is what makes Rsbuild derive `output.publicPath`, `output.uniqueName` and the
 * development asset prefix for a remote, which is otherwise a container's
 * single most common way to break — its chunks resolve against the shell's
 * origin and nothing says so.
 */

import type { RsbuildPlugin } from '@rsbuild/core'

import { containerPostcssPlugins } from './css/postcss-plugins.ts'
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

        // Rsbuild's own federation plugin applies three defaults, but only for
        // a config that already declares `moduleFederation.options` when its
        // `modifyRsbuildConfig` runs. These arrive from a plugin, which is
        // later, so its guard sees nothing and none of them are applied. They
        // are repeated here rather than relied on, and each one is skipped
        // when the author set it.
        const original = api.getRsbuildConfig('original')

        return mergeRsbuildConfig(config, {
          moduleFederation: { options: buildFederationOptions(plan) },
          server: {
            // A remote is read cross-origin by a shell, always.
            ...(original.server?.cors === undefined ? { cors: true } : {}),
            // A container's port is written into the shell's registry by
            // generation, so it is part of its address rather than a
            // preference. The bundler's default is to pick another port when
            // this one is busy, which produces a container the shell cannot
            // find — and, when it lands on a sibling's port, stops that one
            // too. Failing here names the real problem.
            ...(original.server?.strictPort === undefined ? { strictPort: true } : {}),
          },
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
            : {
                dev: {
                  ...(original.dev?.assetPrefix === undefined ? { assetPrefix: true } : {}),
                  // The hot-update client reads the *page's* location for its
                  // socket, and the page belongs to the shell. Without this a
                  // remote opens a second connection to the shell's dev server
                  // and acts on the shell's rebuilds as if they were its own.
                  ...(original.dev?.client?.port === undefined && config.server?.port !== undefined
                    ? { client: { port: config.server.port } }
                    : {}),
                },
              }),
          // Nothing ever requests a container's application entry: a shell
          // reads the manifest, loads remoteEntry.js and pulls the exposed
          // chunks. Pointing the bundler at the container's own source builds
          // the whole application a second time into a graph no one loads.
          ...(original.source?.entry === undefined
            ? { source: { entry: { index: plan.entryStub } } }
            : {}),
          tools: {
            // Tailwind expands the generated stylesheet, then the design
            // system's scope plugin wraps what it emitted. Appending them here
            // rather than asking the container for a PostCSS config is what
            // keeps the whole mechanism invisible: the stylesheet is generated,
            // so nothing an author wrote would say how to compile it.
            postcss: (postcss, { addPlugins }) => {
              addPlugins(
                containerPostcssPlugins({
                  scopes: plan.scopes,
                  containerRoot: plan.options.containerRoot,
                  configured: postcss.postcssOptions,
                }),
              )
            },
            rspack: { plugins: [new MfeRspackPlugin(options)] },
          },
        })
      })
    },
  }
}
