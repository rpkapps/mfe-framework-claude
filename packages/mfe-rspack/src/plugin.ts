/**
 * `mfePlugin()` — an ordinary Rspack plugin.
 *
 * ```ts
 * import { mfePlugin } from '@company/mfe-rspack'
 *
 * export default {
 *   entry: './src/main.ts',
 *   plugins: [mfePlugin()],
 * }
 * ```
 *
 * Not a `withMfe(config)` wrapper. A wrapper owns the whole config object, so
 * every ordinary Rspack option becomes something the wrapper has an opinion
 * about, and an author who needs one the wrapper did not anticipate has nowhere
 * to put it. A plugin composes with whatever else is in the array, and the rest
 * of the config stays ordinary Rspack.
 *
 * What it owns: discovery of the container's definitions, static validation of
 * the entry, capability extraction, the generated modules and entries,
 * container-relative asset URLs, scoped CSS, the supported React Compiler
 * transform, and every Module Federation setting the page depends on.
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

export const PLUGIN_NAME = 'MfePlugin'

/**
 * The plugin instance. `mfePlugin()` is the way to construct one; the class is
 * exported so a host build can name the type.
 */
export class MfeRspackPlugin implements RspackPluginInstance {
  readonly name = PLUGIN_NAME
  readonly #options: MfePluginOptions
  #plan: ContainerPlan | undefined

  constructor(options: MfePluginOptions = {}) {
    this.#options = options
  }

  /** The plan for a container root, computed once and reused. */
  plan(containerRoot: string): ContainerPlan {
    this.#plan ??= planContainer({ ...this.#options, defaultRoot: containerRoot })
    return this.#plan
  }

  /** Re-reads the container's sources and rewrites what changed. */
  refresh(containerRoot: string): ContainerPlan {
    const plan = planContainer({ ...this.#options, defaultRoot: containerRoot })
    this.#plan = plan
    writeGeneratedFiles(plan.generated.files)
    return plan
  }

  apply(compiler: Compiler): void {
    const containerRoot = this.#options.containerRoot ?? compiler.context
    const plan = this.refresh(containerRoot)

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

    applyResolve(compiler, plan)
    applyOutput(compiler)
    applyReactCompiler(compiler, plan)

    new ModuleFederationPlugin(
      buildFederationOptions(plan) as unknown as ConstructorParameters<
        typeof ModuleFederationPlugin
      >[0],
    ).apply(compiler)

    compiler.hooks.beforeCompile.tap(PLUGIN_NAME, () => {
      this.refresh(containerRoot)
    })

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      const current = this.#plan ?? plan
      reportDiagnostics(compilation, current)

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

/** Constructs the plugin. This is the documented entry point. */
export function mfePlugin(options: MfePluginOptions = {}): MfeRspackPlugin {
  return new MfeRspackPlugin(options)
}

/* -------------------------------------------------------------------------- */
/* Compiler wiring                                                             */
/* -------------------------------------------------------------------------- */

function applyResolve(compiler: Compiler, plan: ContainerPlan): void {
  const resolve = compiler.options.resolve
  resolve.alias = { ...resolve.alias, ...plan.aliases }
  resolve.extensions ??= ['.ts', '.tsx', '.js', '.jsx', '.json']
}

/**
 * `auto` is what makes an imported asset and `new URL('./x.svg',
 * import.meta.url)` resolve against the container's own deployed location
 * rather than against the shell document.
 */
function applyOutput(compiler: Compiler): void {
  compiler.options.output.publicPath ??= 'auto'
}

/**
 * The supported React Compiler transform.
 *
 * It runs `enforce: 'pre'`, ahead of the bundler's own TypeScript and JSX
 * handling, because the compiler reads the source structure those transforms
 * erase. Authors do not configure the compiler; `reactCompiler: false` turns it
 * off for a build so a repository can run its matrix compiled and uncompiled.
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

/* -------------------------------------------------------------------------- */
/* Compilation hooks                                                           */
/* -------------------------------------------------------------------------- */

function reportDiagnostics(compilation: Compilation, plan: ContainerPlan): void {
  for (const diagnostic of plan.diagnostics) {
    compilation.errors.push(diagnostic)
  }
}

/**
 * Scopes every stylesheet the compilation produced.
 *
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
      const result = transformScopedCss(asset.source.source().toString(), {
        scope: plan.scopes,
        from: asset.name,
      })
      compilation.updateAsset(asset.name, new RawSource(result.css))
    } catch (error) {
      compilation.errors.push(error as Error)
    }
  }
}

/**
 * Ships the shell registry descriptor and the runtime configuration schema with
 * the container, so the deployment carries what the shell and the release
 * pipeline read.
 */
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
