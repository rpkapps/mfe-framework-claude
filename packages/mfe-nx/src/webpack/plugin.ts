/**
 * The webpack half of the Angular build integration. It turns whatever Angular's builder
 * configured into a Module Federation remote: the container's entry, output, federation, generated
 * modules and stylesheet are derived from its sources and are not configurable per project,
 * because a page only works when every container agrees on them.
 */

import { ModuleFederationPlugin } from '@module-federation/enhanced/webpack'
import type { Compiler, WebpackError, WebpackPluginInstance } from 'webpack'

import {
  applyContainerCompilation,
  buildFederationOptions,
  isMfeBuildError,
  type ContainerPlan,
} from '@company/mfe-build'

import type { MfeAngularOptions } from '../options.ts'
import { createContainerPlanner } from '../plan.ts'
import { applyContainerStylesheet } from './stylesheet.ts'

const PLUGIN_NAME = 'MfePlugin'

export interface MfeWebpackPluginSettings {
  /**
   * Ship the declared defaults as the container's runtime configuration. Off for a dev server,
   * which serves the developer's own copy from `.mfe/` instead; defaults to a production-mode
   * compile.
   */
  readonly emitRuntimeConfig?: boolean
}

export class MfeWebpackPlugin implements WebpackPluginInstance {
  readonly name = PLUGIN_NAME
  readonly #options: MfeAngularOptions
  readonly #settings: MfeWebpackPluginSettings

  constructor(options: MfeAngularOptions = {}, settings: MfeWebpackPluginSettings = {}) {
    this.#options = options
    this.#settings = settings
  }

  apply(compiler: Compiler): void {
    // What a container exposes and shares cannot change without a restart, so the compiler is
    // configured from this plan; the same planner, which the `generate` executor also runs,
    // re-reads the sources before every compile after the first.
    const replan = createContainerPlanner({
      ...this.#options,
      containerRoot: this.#options.containerRoot ?? compiler.context,
    })
    const plan = replan()

    applyContainerShape(compiler, plan)
    new ModuleFederationPlugin(buildFederationOptions(plan)).apply(compiler)

    const currentPlan = applyContainerCompilation(compiler, {
      name: PLUGIN_NAME,
      plan,
      replan,
      emitRuntimeConfig: this.#settings.emitRuntimeConfig,
      toError: diagnostic => toCompilationError(compiler, diagnostic),
      federationRepair:
        "Check that the project's customWebpackConfig still returns withMfe() and that nothing removed the ModuleFederationPlugin it adds.",
    })
    applyContainerStylesheet(compiler, currentPlan)
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
