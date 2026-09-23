/**
 * The Rspack half of the build integration; CSS scoping and federation stay in `pluginMfe()`,
 * because declaring `moduleFederation.options` is what makes Rsbuild derive a remote's own
 * paths (§13).
 */

import { createRequire } from 'node:module'

import { tanstackRouter } from '@tanstack/router-plugin/rspack'
import type { Compiler, RspackPluginInstance, RuleSetUse } from '@rspack/core'

import { applyContainerCompilation } from '@company/mfe-build'

import { ownsRouteTree, routeTreeOptions } from './generate/route-tree.ts'
import type { ContainerPlan } from './plan.ts'

const require = createRequire(import.meta.url)

const PLUGIN_NAME = 'MfePlugin'

export interface MfeRspackPluginSettings {
  /**
   * Ship the declared defaults as the container's runtime configuration. Off for a dev server,
   * whose `public/` copy carries the developer's values; defaults to a production-mode compile.
   */
  readonly emitRuntimeConfig?: boolean
}

export class MfeRspackPlugin implements RspackPluginInstance {
  readonly name = PLUGIN_NAME
  readonly #plan: ContainerPlan
  readonly #replan: () => ContainerPlan
  readonly #settings: MfeRspackPluginSettings

  /**
   * `plan` is the one the Rsbuild config was derived from; `replan` is the planner that made it,
   * run again before every later compile, so a build and `mfe-generate` read one function.
   */
  constructor(
    plan: ContainerPlan,
    replan: () => ContainerPlan,
    settings: MfeRspackPluginSettings = {},
  ) {
    this.#plan = plan
    this.#replan = replan
    this.#settings = settings
  }

  apply(compiler: Compiler): void {
    const plan = this.#plan

    // The route tree has to exist before anything reads it, including a typecheck run.
    if (ownsRouteTree(plan)) {
      tanstackRouter({
        ...routeTreeOptions(plan),
        ...(plan.options.router === false ? {} : plan.options.router),
      }).apply?.(compiler)
    }

    compiler.options.resolve.alias = { ...compiler.options.resolve.alias, ...plan.aliases }
    // Assets have to resolve against the container's own deployed location, not the shell
    // document; Rsbuild sets this from the federation options, so `auto` is only a fallback.
    compiler.options.output.publicPath ??= 'auto'
    applyReactCompiler(compiler, plan)

    applyContainerCompilation(compiler, {
      name: PLUGIN_NAME,
      plan,
      replan: this.#replan,
      emitRuntimeConfig: this.#settings.emitRuntimeConfig,
      // A build leaves the developer's copy out of the public directory instead (`pluginMfe`).
      copiedRuntimeConfig: 'keep',
      toError: error => error,
      federationRepair:
        "Check that the Rsbuild config still applies pluginMfe() and that nothing replaced the container's moduleFederation options.",
    })
  }
}

/** Runs `enforce: 'pre'`: the compiler reads source structure those transforms erase. */
function applyReactCompiler(compiler: Compiler, plan: ContainerPlan): void {
  if (!plan.options.reactCompiler) return

  const babelLoader = require.resolve('babel-loader')
  const reactCompiler = require.resolve('babel-plugin-react-compiler')
  const exclude = [/[\\/]node_modules[\\/]/, plan.options.generatedDir]

  const use = (jsx: boolean): RuleSetUse => [
    {
      loader: babelLoader,
      options: {
        babelrc: false,
        configFile: false,
        browserslistConfigFile: false,
        compact: false,
        sourceMaps: true,
        parserOpts: { plugins: jsx ? ['typescript', 'jsx'] : ['typescript'] },
        plugins: [[reactCompiler, {}]],
      },
    },
  ]

  compiler.options.module.rules.push(
    { test: /\.tsx$/, exclude, enforce: 'pre', use: use(true) },
    { test: /\.ts$/, exclude, enforce: 'pre', use: use(false) },
    { test: /\.jsx?$/, exclude, enforce: 'pre', use: use(true) },
  )
}
