/**
 * `mfePlugin()` — an ordinary Rspack plugin, not a `withMfe(config)` wrapper: a
 * wrapper would own the whole config object, and an author needing an option it
 * did not anticipate would have nowhere to put it. It owns discovery, entry
 * validation, capability extraction, the generated modules, asset URLs, scoped
 * CSS, the React Compiler transform and every Module Federation setting.
 */

import { createRequire } from 'node:module'

import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import { tanstackRouter } from '@tanstack/router-plugin/rspack'
import type { Compilation, Compiler, RspackPluginInstance, RuleSetUse } from '@rspack/core'

import { transformScopedCss } from './css/scope-transform.ts'
import { buildFederationOptions } from './federation/federation-options.ts'
import { writeGeneratedFiles } from './generate/emit.ts'
import type { MfePluginOptions } from './options.ts'
import { planContainer, type ContainerPlan } from './plan.ts'

const require = createRequire(import.meta.url)

const PLUGIN_NAME = 'MfePlugin'

class MfeRspackPlugin implements RspackPluginInstance {
  readonly name = PLUGIN_NAME
  readonly #options: MfePluginOptions
  #plan: ContainerPlan | undefined

  constructor(options: MfePluginOptions = {}) {
    this.#options = options
  }

  /** Re-reads the container's sources and rewrites what changed. */
  #refresh(containerRoot: string): ContainerPlan {
    const plan = planContainer({ ...this.#options, defaultRoot: containerRoot })
    this.#plan = plan
    writeGeneratedFiles(plan.generated.files)
    return plan
  }

  apply(compiler: Compiler): void {
    const containerRoot = this.#options.containerRoot ?? compiler.context
    const plan = this.#refresh(containerRoot)

    // The route tree has to exist before anything reads it, including a
    // typecheck run, so the router plugin is applied ahead of everything here.
    // Pass `router: false` when the container's own config already applies it,
    // and apply it before mfePlugin() so the ordering is the same.
    if (plan.options.router !== false && plan.discovery.app !== undefined) {
      tanstackRouter({
        target: 'react',
        routesDirectory: plan.options.routesDirectory,
        generatedRouteTree: `${plan.options.containerRoot}/src/routeTree.gen.ts`,
        autoCodeSplitting: true,
        ...plan.options.router,
      }).apply?.(compiler)
    }

    compiler.options.resolve.alias = { ...compiler.options.resolve.alias, ...plan.aliases }
    // `auto` is what makes an imported asset and `new URL('./x.svg',
    // import.meta.url)` resolve against the container's own deployed location
    // rather than against the shell document.
    compiler.options.output.publicPath ??= 'auto'
    applyReactCompiler(compiler, plan)

    new ModuleFederationPlugin(
      buildFederationOptions(plan) as unknown as ConstructorParameters<
        typeof ModuleFederationPlugin
      >[0],
    ).apply(compiler)

    compiler.hooks.beforeCompile.tap(PLUGIN_NAME, () => {
      this.#refresh(containerRoot)
    })

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      const current = this.#plan ?? plan
      for (const diagnostic of current.diagnostics) compilation.errors.push(diagnostic)

      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          stage: compiler.rspack.Compilation.PROCESS_ASSETS_STAGE_DERIVED,
        },
        () => {
          scopeStyleSheets(compiler, compilation, current)
          emitContainerArtifacts(compiler, compilation, current)
        },
      )
    })
  }
}

export function mfePlugin(options: MfePluginOptions = {}): RspackPluginInstance {
  return new MfeRspackPlugin(options)
}

/**
 * Runs `enforce: 'pre'`, ahead of the bundler's own TypeScript and JSX
 * handling, because the compiler reads the source structure those transforms
 * erase. Authors do not configure the compiler; `reactCompiler: false` turns it
 * off so a repository can run its matrix compiled and uncompiled.
 */
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

/**
 * Working on the emitted asset rather than on each source file means the
 * container's resets and tokens are scoped once, in their final deduplicated
 * form, instead of once per module that imported them.
 */
function scopeStyleSheets(compiler: Compiler, compilation: Compilation, plan: ContainerPlan): void {
  if (plan.scopes.length === 0) return
  const { RawSource } = compiler.rspack.sources

  for (const asset of compilation.getAssets()) {
    if (!asset.name.endsWith('.css')) continue

    try {
      const scoped = transformScopedCss(asset.source.source().toString(), {
        scope: plan.scopes,
        from: asset.name,
      })
      compilation.updateAsset(asset.name, new RawSource(scoped))
    } catch (error) {
      compilation.errors.push(error as Error)
    }
  }
}

/** Ships the registry descriptor and config schema with the container. */
function emitContainerArtifacts(
  compiler: Compiler,
  compilation: Compilation,
  plan: ContainerPlan,
): void {
  const { RawSource } = compiler.rspack.sources

  for (const file of plan.generated.files) {
    const name = file.path.slice(plan.options.generatedDir.length + 1)
    if (!name.endsWith('.json') || name.includes('/')) continue
    if (name === 'tsconfig.paths.json') continue
    if (compilation.getAsset(name) !== undefined) continue
    compilation.emitAsset(name, new RawSource(file.contents))
  }
}
