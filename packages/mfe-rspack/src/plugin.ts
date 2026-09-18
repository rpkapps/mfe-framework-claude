/**
 * The Rspack half of the framework's build integration: discovery, entry
 * validation, capability extraction, the generated modules, asset URLs, scoped
 * CSS and the React Compiler transform.
 *
 * Module Federation is deliberately not here. Rsbuild registers the federation
 * plugin itself when a config declares `moduleFederation.options`, and doing it
 * that way is what makes Rsbuild set `output.publicPath`, `output.uniqueName`
 * and the dev asset prefix correctly for a remote. `pluginMfe()` in
 * `rsbuild.ts` supplies those options, so an author still never writes one.
 *
 * This is an internal seam. `pluginMfe()` is the public entry.
 */

import { createRequire } from 'node:module'

import { tanstackRouter } from '@tanstack/router-plugin/rspack'
import type { Compilation, Compiler, RspackPluginInstance, RuleSetUse } from '@rspack/core'

import { transformScopedCss } from './css/scope-transform.ts'
import { withFrameworkMetadata } from './federation/federation-options.ts'
import { generateContainer } from './generate/container.ts'
import { ownsRouteTree, routeTreeOptions } from './generate/route-tree.ts'
import type { MfePluginOptions } from './options.ts'
import type { ContainerPlan } from './plan.ts'

const require = createRequire(import.meta.url)

const PLUGIN_NAME = 'MfePlugin'

export class MfeRspackPlugin implements RspackPluginInstance {
  readonly name = PLUGIN_NAME
  readonly #options: MfePluginOptions
  #plan: ContainerPlan | undefined

  constructor(options: MfePluginOptions = {}) {
    this.#options = options
  }

  /**
   * The same generation `mfe-generate` performs, so what a build writes and
   * what a developer's editor reads are produced by one function.
   */
  #refresh(containerRoot: string): ContainerPlan {
    const { plan } = generateContainer({ ...this.#options, defaultRoot: containerRoot })
    this.#plan = plan
    return plan
  }

  apply(compiler: Compiler): void {
    const containerRoot = this.#options.containerRoot ?? compiler.context
    const plan = this.#refresh(containerRoot)

    // The route tree has to exist before anything reads it, including a
    // typecheck run, so the router plugin is applied ahead of everything here.
    // Pass `router: false` when the container's own config already applies it,
    // and apply it before pluginMfe() so the ordering is the same.
    if (ownsRouteTree(plan)) {
      tanstackRouter({
        ...routeTreeOptions(plan),
        ...(plan.options.router === false ? {} : plan.options.router),
      }).apply?.(compiler)
    }

    compiler.options.resolve.alias = { ...compiler.options.resolve.alias, ...plan.aliases }
    // An imported asset and `new URL('./x.svg', import.meta.url)` have to
    // resolve against the container's own deployed location rather than the
    // shell document. Rsbuild sets this from the federation options — in
    // development to an absolute URL for this container's own server — so the
    // `auto` below is only the fallback for a config that declares none.
    compiler.options.output.publicPath ??= 'auto'
    applyReactCompiler(compiler, plan)

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

      // The federation manifest is written during processAssets, so the
      // metadata goes in at the last stage, once it exists.
      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          stage: compiler.rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          addFrameworkMetadata(compiler, compilation, current)
        },
      )
    })
  }
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

/**
 * Puts the framework contract metadata in the federation manifest's own
 * metadata area (§10.3.1), rather than in a second manifest that would
 * eventually disagree with this one about which build it describes.
 */
function addFrameworkMetadata(
  compiler: Compiler,
  compilation: Compilation,
  plan: ContainerPlan,
): void {
  const name = plan.options.manifestFileName
  const asset = compilation.getAsset(name)

  if (asset === undefined) {
    compilation.errors.push(
      new Error(
        `${PLUGIN_NAME}: no ${name} was emitted, so this container advertises no framework ` +
          'contract and a shell cannot tell which major it was built against. Check that the ' +
          "Rsbuild config still applies pluginMfe() and that nothing replaced the container's " +
          'moduleFederation options.',
      ),
    )
    return
  }

  const stats = JSON.parse(asset.source.source().toString()) as Record<string, unknown>
  const { RawSource } = compiler.rspack.sources

  compilation.updateAsset(
    name,
    new RawSource(
      `${JSON.stringify(withFrameworkMetadata(stats, plan.generated.frameworkMetadata), null, 2)}\n`,
    ),
  )
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
