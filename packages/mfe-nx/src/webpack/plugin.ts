/**
 * The webpack half of the Angular build integration. It turns whatever Angular's builder
 * configured into a Module Federation remote: the container's entry, output, federation, generated
 * modules and stylesheet are derived from its sources and are not configurable per project,
 * because a page only works when every container agrees on them.
 */

import { relative, sep } from 'node:path'

import { ModuleFederationPlugin } from '@module-federation/enhanced/webpack'
import type { Compilation, Compiler, WebpackError, WebpackPluginInstance } from 'webpack'

import {
  buildFederationOptions,
  isMfeBuildError,
  RUNTIME_CONFIG_DEFAULTS_FILE,
  withFrameworkMetadata,
  type ContainerPlan,
} from '@company/mfe-build'

import { generateContainer } from '../generate/container.ts'
import type { MfeAngularOptions } from '../options.ts'
import { applyContainerStylesheet } from './stylesheet.ts'

const PLUGIN_NAME = 'MfePlugin'

export interface MfeWebpackPluginSettings {
  /**
   * Ship the declared defaults as the container's runtime configuration. Off for a dev server,
   * whose `public/` copy carries the developer's values; defaults to a production-mode compile.
   */
  readonly emitRuntimeConfig?: boolean
}

export class MfeWebpackPlugin implements WebpackPluginInstance {
  readonly name = PLUGIN_NAME
  readonly #options: MfeAngularOptions
  readonly #settings: MfeWebpackPluginSettings
  #plan: ContainerPlan | undefined

  constructor(options: MfeAngularOptions = {}, settings: MfeWebpackPluginSettings = {}) {
    this.#options = options
    this.#settings = settings
  }

  /** The same generation the `generate` executor performs, so a build and an editor agree. */
  #refresh(containerRoot: string): ContainerPlan {
    const { plan } = generateContainer({ ...this.#options, defaultRoot: containerRoot })
    this.#plan = plan
    return plan
  }

  apply(compiler: Compiler): void {
    const containerRoot = this.#options.containerRoot ?? compiler.context
    // Read once here, because what a container exposes and shares cannot change without a
    // restart; the generated modules are rewritten before every compile.
    const plan = this.#refresh(containerRoot)
    const currentPlan = (): ContainerPlan => this.#plan ?? plan

    applyContainerShape(compiler, plan)
    applyContainerStylesheet(compiler, currentPlan)
    new ModuleFederationPlugin(buildFederationOptions(plan)).apply(compiler)

    compiler.hooks.beforeCompile.tap(PLUGIN_NAME, () => {
      this.#refresh(containerRoot)
    })

    const emitRuntimeConfig =
      this.#settings.emitRuntimeConfig ?? compiler.options.mode === 'production'

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      const current = currentPlan()
      for (const diagnostic of current.diagnostics) {
        compilation.errors.push(toCompilationError(compiler, diagnostic))
      }

      compilation.hooks.processAssets.tap(
        { name: PLUGIN_NAME, stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_DERIVED },
        () => {
          emitContainerArtifacts(compiler, compilation, current, emitRuntimeConfig)
        },
      )

      // The federation manifest is written during processAssets, so the metadata goes in last.
      compilation.hooks.processAssets.tap(
        { name: PLUGIN_NAME, stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT },
        () => {
          addFrameworkMetadata(compiler, compilation, current)
        },
      )
    })
  }
}

/**
 * What Angular's builder configures for an application and a remote needs otherwise. This runs
 * before webpack applies its defaults, so it replaces the builder's values rather than racing
 * them.
 */
function applyContainerShape(compiler: Compiler, plan: ContainerPlan): void {
  const { options } = compiler

  // Nothing ever requests a container's application entry, and a polyfills or global-styles entry
  // would be a page-level bundle no shell loads; the exposed entries are the container.
  options.entry = { main: { import: [plan.entryStub] } }

  // Names the chunk-loading global, which two remotes on one page must never share.
  options.output.uniqueName = plan.options.federationName
  // Assets resolve against the container's own deployed location, not the shell document.
  if (options.output.publicPath === undefined || options.output.publicPath === '') {
    options.output.publicPath = 'auto'
  }
  // Angular loads its chunks as module scripts for its own index.html; a remote's chunks are
  // loaded by its remote entry, as classic scripts like every other remote on the page.
  options.output.scriptType = 'text/javascript'
  // A remote entry has to carry its own runtime; a separate runtime chunk would never be loaded.
  options.optimization.runtimeChunk = false
  // The generated configuration module awaits the deployed values before anything evaluates.
  // Angular targets webpack's own runtime at ES2015 and leaves the rest to its own transpiler,
  // but every browser Angular 19 supports runs async functions, which that await compiles to.
  options.experiments.topLevelAwait = true
  options.output.environment = { ...options.output.environment, asyncFunction: true }

  options.resolve.alias = withAliases(options.resolve.alias, plan.aliases)
  // The generated modules import each other by their `.ts` name, which the container's tsconfig
  // has the compiler rewrite to `.js` in the code it hands webpack; this maps those back.
  options.resolve.extensionAlias = {
    [TYPESCRIPT_OUTPUT_EXTENSION]: ['.ts', TYPESCRIPT_OUTPUT_EXTENSION],
    ...options.resolve.extensionAlias,
  }
}

const TYPESCRIPT_OUTPUT_EXTENSION = '.js'

type ResolveAlias = NonNullable<Compiler['options']['resolve']['alias']>

function withAliases(
  existing: ResolveAlias | undefined,
  aliases: Readonly<Record<string, string>>,
): ResolveAlias {
  if (Array.isArray(existing)) {
    return [...existing, ...Object.entries(aliases).map(([name, alias]) => ({ name, alias }))]
  }
  return { ...existing, ...aliases }
}

/** Webpack reports its own error type; the file keeps the report pointing where to look. */
function toCompilationError(compiler: Compiler, diagnostic: Error): WebpackError {
  const error = new compiler.webpack.WebpackError(diagnostic.message)
  error.name = diagnostic.name
  if (isMfeBuildError(diagnostic)) error.file = diagnostic.file
  return error
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
      new compiler.webpack.WebpackError(
        `${PLUGIN_NAME}: no ${name} was emitted, so this container declares no framework ` +
          'contract and a shell cannot tell which major it was built against. Check that the ' +
          "project's customWebpackConfig still returns withMfe() and that nothing removed the " +
          'ModuleFederationPlugin it adds.',
      ),
    )
    return
  }

  const stats = JSON.parse(asset.source.source().toString()) as Record<string, unknown>
  const { RawSource } = compiler.webpack.sources

  compilation.updateAsset(
    name,
    new RawSource(
      `${JSON.stringify(withFrameworkMetadata(stats, plan.generated.frameworkMetadata), null, 2)}\n`,
    ),
  )
}

/**
 * Ships the registry entry and config schema with the container, and in a build the declared
 * defaults as its runtime configuration, which the start-up script writes the environment over.
 */
function emitContainerArtifacts(
  compiler: Compiler,
  compilation: Compilation,
  plan: ContainerPlan,
  emitRuntimeConfig: boolean,
): void {
  const { RawSource } = compiler.webpack.sources

  for (const file of plan.generated.files) {
    // Normalized, because `join` uses backslashes on Windows and these checks are about shape.
    const name = relative(plan.options.generatedDir, file.path).split(sep).join('/')
    if (!name.endsWith('.json') || name.includes('/')) continue
    if (name === 'tsconfig.paths.json') continue

    if (name === RUNTIME_CONFIG_DEFAULTS_FILE) {
      if (emitRuntimeConfig) shipDefaults(compilation, plan, new RawSource(file.contents))
      continue
    }
    if (compilation.getAsset(name) !== undefined) continue
    compilation.emitAsset(name, new RawSource(file.contents))
  }
}

/**
 * Angular copies `public/` as assets before this runs, and that copy is the developer's, with
 * values such as a localhost API. A build ships the declared defaults in its place, so no local
 * value is ever deployed.
 */
function shipDefaults(
  compilation: Compilation,
  plan: ContainerPlan,
  defaults: InstanceType<Compiler['webpack']['sources']['RawSource']>,
): void {
  const name = plan.options.runtimeConfigFileName
  if (compilation.getAsset(name) === undefined) compilation.emitAsset(name, defaults)
  else compilation.updateAsset(name, defaults)
}
