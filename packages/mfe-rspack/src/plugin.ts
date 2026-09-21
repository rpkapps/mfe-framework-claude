/**
 * The Rspack half of the build integration; CSS scoping and federation stay in `pluginMfe()`,
 * because declaring `moduleFederation.options` is what makes Rsbuild derive a remote's own
 * paths (§13).
 */

import { createRequire } from 'node:module'
import { relative, sep } from 'node:path'

import { tanstackRouter } from '@tanstack/router-plugin/rspack'
import type { Compilation, Compiler, RspackPluginInstance, RuleSetUse } from '@rspack/core'

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

  /** The same generation `mfe-generate` performs, so a build and an editor read one function. */
  #refresh(containerRoot: string): ContainerPlan {
    const { plan } = generateContainer({ ...this.#options, defaultRoot: containerRoot })
    this.#plan = plan
    return plan
  }

  apply(compiler: Compiler): void {
    const containerRoot = this.#options.containerRoot ?? compiler.context
    const plan = this.#refresh(containerRoot)

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
          emitContainerArtifacts(compiler, compilation, current)
        },
      )

      // The federation manifest is written during processAssets, so the metadata goes in last.
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

/** Into the federation manifest's own metadata area; a second manifest would disagree. */
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
    // Normalized, because `join` uses backslashes on Windows and these checks are about shape.
    const name = relative(plan.options.generatedDir, file.path).split(sep).join('/')
    if (!name.endsWith('.json') || name.includes('/')) continue
    if (name === 'tsconfig.paths.json') continue
    if (compilation.getAsset(name) !== undefined) continue
    compilation.emitAsset(name, new RawSource(file.contents))
  }
}
