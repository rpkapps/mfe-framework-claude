/**
 * `withMfe()`: the container build for a plain Rspack configuration, such as the one
 * `@nx/angular-rspack`'s `createConfig` resolves to, where there is no Rsbuild to contribute to.
 * It sets up what `pluginMfe()` does — generation, federation, the scoped stylesheet — on the
 * configuration itself.
 */

import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import type { Compiler, Configuration, RspackPluginInstance } from '@rspack/core'

import { containerPostcssPlugins } from './css/postcss-plugins.ts'
import { buildFederationOptions } from './federation/federation-options.ts'
import type { MfePluginOptions } from './options.ts'
import { planContainer, type ContainerPlan } from './plan.ts'
import { MfeRspackPlugin } from './plugin.ts'

export { buildFederationOptions, MfeRspackPlugin, planContainer }
export type { FederationOptions } from './federation/federation-options.ts'
export type { MfePluginOptions } from './options.ts'
export type { ContainerPlan, PlanContainerOptions } from './plan.ts'
export type { MfeRspackPluginSettings } from './plugin.ts'

const require = createRequire(import.meta.url)

type DevServer = Exclude<Configuration['devServer'], false | undefined>
type DevServerClient = Exclude<DevServer['client'], undefined>

/**
 * Returns the configuration in the shape it was given: one, an array of them, or a promise of
 * either, which is what `createConfig` resolves to. The container is planned once per root, as
 * `pluginMfe()` plans it; the Rspack plugin re-reads the sources before every compilation.
 */
export function withMfe(config: Configuration, options?: MfePluginOptions): Configuration
export function withMfe(
  config: readonly Configuration[],
  options?: MfePluginOptions,
): Configuration[]
export function withMfe<T extends Configuration | readonly Configuration[]>(
  config: PromiseLike<T>,
  options?: MfePluginOptions,
): Promise<T extends readonly Configuration[] ? Configuration[] : Configuration>
export function withMfe(
  config:
    | Configuration
    | readonly Configuration[]
    | PromiseLike<Configuration | readonly Configuration[]>,
  options: MfePluginOptions = {},
): Configuration | Configuration[] | Promise<Configuration | Configuration[]> {
  if (isPromiseLike(config)) {
    return Promise.resolve(config).then(resolved => applyToEach(resolved, options))
  }
  return applyToEach(config, options)
}

function applyToEach(
  config: Configuration | readonly Configuration[],
  options: MfePluginOptions,
): Configuration | Configuration[] {
  const plans = new Map<string, ContainerPlan>()
  const planFor = (root: string): ContainerPlan => {
    const known = plans.get(root)
    if (known !== undefined) return known
    const plan = planContainer({ ...options, defaultRoot: root })
    plans.set(root, plan)
    return plan
  }

  return isConfigurationList(config)
    ? config.map(each => containerConfiguration(each, options, planFor))
    : containerConfiguration(config, options, planFor)
}

function containerConfiguration(
  config: Configuration,
  options: MfePluginOptions,
  planFor: (root: string) => ContainerPlan,
): Configuration {
  const plan = planFor(resolve(options.containerRoot ?? config.context ?? process.cwd()))
  const output = config.output ?? {}
  const alias = config.resolve?.alias === false ? {} : config.resolve?.alias

  return {
    ...config,
    // Nothing requests a container's application entry, so a configuration without one gets the
    // generated stub rather than Rspack's `./src` default.
    ...(config.entry === undefined ? { entry: { index: plan.entryStub } } : {}),
    output: {
      ...output,
      // Chunks and assets resolve against where remoteEntry.js was served from. The '' that
      // `@nx/angular-rspack` writes when no deployUrl is set resolves them against the shell's
      // document instead, so it counts as unset.
      publicPath:
        output.publicPath === undefined || output.publicPath === ''
          ? 'auto'
          : output.publicPath,
      // The runtime keys its chunk-loading and hot-update globals by this name, so two
      // containers on one page must differ. The federation name is unique by construction; the
      // Nx project name `@nx/angular-rspack` uses otherwise is not, across workspaces.
      uniqueName: plan.options.federationName,
    },
    resolve: {
      ...config.resolve,
      alias: { ...alias, ...plan.aliases },
      // Container modules, the generated ones included, import each other by their `.ts` name.
      // A compiler that emits JavaScript first — Angular's, with TypeScript's
      // `rewriteRelativeImportExtensions` — turns those into `.js` names no file has.
      extensionAlias: { '.js': ['.ts', '.js'], ...config.resolve?.extensionAlias },
    },
    optimization: {
      ...config.optimization,
      // One runtime chunk shared by every entry leaves remoteEntry.js unable to start by itself,
      // which is the only way a shell ever starts it.
      runtimeChunk: false,
    },
    devServer: containerDevServer(config.devServer, plan),
    plugins: [
      ...(config.plugins ?? []),
      new MfeRspackPlugin(options),
      new ModuleFederationPlugin(buildFederationOptions(plan)),
      new ContainerStylesheetPlugin(plan),
    ],
  }
}

function containerDevServer(
  devServer: Configuration['devServer'],
  plan: ContainerPlan,
): DevServer | false {
  if (devServer === false) return false

  const port = devServer?.port ?? plan.options.devPort
  return {
    ...devServer,
    // A shell reads a remote cross-origin, always. Headers given as a list or a function are the
    // author's to complete.
    ...(devServer?.headers === undefined || isHeaderRecord(devServer.headers)
      ? { headers: { 'Access-Control-Allow-Origin': '*', ...devServer?.headers } }
      : {}),
    // The development registry points the shell at the port the manifest declares.
    ...(port === undefined ? {} : { port, client: clientOnPort(devServer?.client, port) }),
  }
}

/**
 * The client finds its server from the page's location, and a mounted container's page is the
 * shell's. Only the port is pinned, so the hostname still follows the page; an explicit port is
 * the author's.
 */
function clientOnPort(client: DevServer['client'], port: number | string): DevServerClient {
  if (client === false) return false

  const settings = typeof client === 'object' ? client : {}
  const url = settings.webSocketURL
  if (typeof url !== 'string') {
    return { ...settings, webSocketURL: { ...url, port: url?.port ?? port } }
  }

  const parsed = new URL(url)
  // `0` asks the client for the page's own port.
  if (parsed.port !== '' && parsed.port !== '0') return settings
  parsed.port = String(port)
  return { ...settings, webSocketURL: parsed.href }
}

/**
 * `@nx/angular-rspack` gives a stylesheet loaders only when it carries its `?ngResource` query (a
 * component's styles, which the Angular compiler inlines and encapsulates itself) or its
 * `?ngGlobalStyle` query (a `styles` entry, linked from index.html alone, which no shell loads).
 * The generated stylesheet every exposed entry imports carries neither, and with
 * `experiments.css` off it would be parsed as JavaScript, so this rule gives any such plain
 * import the whole chain: Tailwind and the container scope, css-loader, and extraction into a CSS
 * chunk the federation runtime loads with the exposed module.
 */
class ContainerStylesheetPlugin implements RspackPluginInstance {
  readonly name = 'MfeContainerStylesheetPlugin'
  readonly #plan: ContainerPlan

  constructor(plan: ContainerPlan) {
    this.#plan = plan
  }

  apply(compiler: Compiler): void {
    const { CssExtractRspackPlugin } = compiler.rspack
    // By name, because the configuration's copy may come from another install of Rspack.
    const extracts = compiler.options.plugins.some(
      plugin =>
        typeof plugin === 'object' &&
        plugin !== null &&
        plugin.constructor.name === CssExtractRspackPlugin.name,
    )
    if (!extracts) new CssExtractRspackPlugin().apply(compiler)

    compiler.options.module.rules.push({
      test: /\.css$/i,
      resourceQuery: { not: [/[?&]ngResource/, /[?&]ngGlobalStyle/] },
      type: 'javascript/auto',
      use: [
        { loader: CssExtractRspackPlugin.loader },
        { loader: require.resolve('css-loader'), options: { importLoaders: 1 } },
        {
          loader: require.resolve('postcss-loader'),
          options: {
            // The stylesheet is generated, so no PostCSS config of the author's compiles it.
            postcssOptions: {
              config: false,
              plugins: containerPostcssPlugins({
                scopes: this.#plan.scopes,
                containerRoot: this.#plan.options.containerRoot,
              }),
            },
          },
        },
      ],
    })
  }
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof (value as { then?: unknown }).then === 'function'
}

function isConfigurationList(
  value: Configuration | readonly Configuration[],
): value is readonly Configuration[] {
  return Array.isArray(value)
}

function isHeaderRecord(headers: unknown): headers is Record<string, string | string[]> {
  return typeof headers === 'object' && headers !== null && !Array.isArray(headers)
}
