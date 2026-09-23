/**
 * Real webpack compiles of a small Angular-shaped container. The configuration stands in for what
 * Angular's builder hands `withMfe()`: an application and a polyfills entry, an empty public path,
 * module scripts, a runtime chunk, no top-level await, and its global- and component-style rules,
 * which only compile a stylesheet whose request carries `?ngGlobalStyle` or `?ngResource`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import { afterEach, describe, expect, it } from 'vitest'
import webpack, {
  type Compilation,
  type Compiler,
  type Configuration,
  type Stats,
  type WebpackPluginInstance,
} from 'webpack'

import { cleanupContainers, createContainer, writeFile } from '../testing/containers.ts'
import { MfeWebpackPlugin, type MfeWebpackPluginSettings } from './plugin.ts'

afterEach(cleanupContainers)

const require = createRequire(__filename)
const TYPESCRIPT_LOADER = join(__dirname, '../testing/typescript-loader.cjs')
const COMPILE_TIMEOUT = 60_000

const APP_ENTRY = `
import { createApp } from '@company/mfe-angular'

import { PanelComponent } from './panel.component'

export const reports = createApp({ id: 'reports', version: '1.2.0', routes: [{ path: '', component: PanelComponent }] })
`

const PANEL_COMPONENT = `
import styles from './panel.component.css?ngResource'

// Tailwind finds the classes a template uses in the component source.
export const template = '<section class="p-4">Panel</section>'

export class PanelComponent {
  readonly styles = styles
}
`

const CONFIG = `
import { env } from '@company/mfe-nx/env'
import { z } from 'zod'

export default {
  reportLimit: env('REPORT_LIMIT', z.number().default(20)),
}
`

function reportsContainer(extra: Readonly<Record<string, string>> = {}): string {
  return createContainer(
    {
      'src/mfe.ts': APP_ENTRY,
      'src/panel.component.ts': PANEL_COMPONENT,
      'src/panel.component.css': '.panel-body { margin: 0; }\n',
      'src/styles.css': '.panel-title { font-weight: 600; }\n',
      'src/mfe.config.ts': CONFIG,
      ...extra,
    },
    { link: ['zod', 'tailwindcss'] },
  )
}

/** Stands in for Angular's own asset copy while watching: `public/` lands before the plugin runs. */
class CopiedPublicConfig implements WebpackPluginInstance {
  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap('CopiedPublicConfig', (compilation: Compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'CopiedPublicConfig',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          compilation.emitAsset(
            'runtime-config.json',
            new compiler.webpack.sources.RawSource('{ "reportLimit": 5 }\n'),
          )
        },
      )
    })
  }
}

function angularLikeConfig(
  root: string,
  mode: 'production' | 'development',
  settings: MfeWebpackPluginSettings = {},
): Configuration {
  return {
    mode,
    context: root,
    entry: { main: ['./src/main.ts'], polyfills: ['./src/polyfills.ts'] },
    output: {
      path: join(root, 'dist'),
      publicPath: '',
      scriptType: 'module',
      uniqueName: 'reports-project',
      filename: '[name].js',
      chunkFilename: '[name].js',
    },
    target: ['web', 'es2015'],
    devtool: false,
    optimization: { minimize: false, runtimeChunk: 'single' },
    experiments: { topLevelAwait: false },
    resolve: {
      extensions: ['.ts', '.mjs', '.js'],
      // The container's `env` import, from this package's own source.
      alias: { '@company/mfe-nx/env': join(__dirname, '../env.ts') },
    },
    module: {
      rules: [
        { test: /\.ts$/, use: [TYPESCRIPT_LOADER] },
        {
          test: /\.css$/i,
          rules: [
            {
              oneOf: [
                {
                  resourceQuery: /\?ngGlobalStyle/,
                  use: [MiniCssExtractPlugin.loader, require.resolve('css-loader')],
                },
                {
                  resourceQuery: /\?ngResource/,
                  use: [
                    {
                      loader: require.resolve('css-loader'),
                      options: { exportType: 'string', esModule: false },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: '[name].css' }),
      new CopiedPublicConfig(),
      new MfeWebpackPlugin({ containerRoot: root }, settings),
    ],
    infrastructureLogging: { level: 'error' },
  }
}

function run(compiler: Compiler): Promise<Stats> {
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error !== null && error !== undefined) reject(error)
      else if (stats === undefined) reject(new Error('webpack produced no stats'))
      else resolve(stats)
    })
  })
}

function close(compiler: Compiler): Promise<void> {
  return new Promise((resolve, reject) => {
    compiler.close(error => {
      if (error !== null && error !== undefined) reject(error)
      else resolve()
    })
  })
}

async function build(config: Configuration): Promise<Stats> {
  const compiler = webpack(config)
  try {
    return await run(compiler)
  } finally {
    await close(compiler)
  }
}

function errorsOf(stats: Stats): readonly string[] {
  return stats.compilation.errors.map(error => error.message)
}

function readDist(root: string, name: string): string {
  return readFileSync(join(root, 'dist', name), 'utf8')
}

function readJsonDist<T>(root: string, name: string): T {
  return JSON.parse(readDist(root, name)) as T
}

interface Manifest {
  readonly metaData: Record<string, unknown> & { readonly mfe?: Record<string, unknown> }
  readonly shared: readonly { readonly name: string }[]
}

describe('MfeWebpackPlugin on a production compile', () => {
  it(
    'turns the Angular application into a Module Federation remote',
    async () => {
      const root = reportsContainer()

      const stats = await build(angularLikeConfig(root, 'production'))

      expect(errorsOf(stats)).toEqual([])
      expect(existsSync(join(root, 'dist/remoteEntry.js'))).toBe(true)

      // The application and polyfills entries are replaced by the generated stub: neither
      // src/main.ts nor src/polyfills.ts exists, so compiling either would have failed.
      expect([...stats.compilation.entrypoints.keys()]).toEqual(['main'])

      const output = stats.compilation.outputOptions
      expect(output.uniqueName).toBe('acme_reports')
      expect(output.publicPath).toBe('auto')
      expect(output.scriptType).toBe('text/javascript')
      expect(output.environment.asyncFunction).toBe(true)
      // The remote entry carries its runtime; no separate runtime chunk exists.
      expect(existsSync(join(root, 'dist/runtime.js'))).toBe(false)
    },
    COMPILE_TIMEOUT,
  )

  it(
    'stamps the federation manifest with the Angular framework, keeping what federation wrote',
    async () => {
      const root = reportsContainer()

      await build(angularLikeConfig(root, 'production'))

      const manifest = readJsonDist<Manifest>(root, 'mf-manifest.json')
      expect(manifest.metaData['name']).toBe('acme_reports')
      expect(manifest.metaData.mfe).toMatchObject({
        kind: 'mfe',
        framework: 'angular',
        entries: { reports: './app' },
      })
    },
    COMPILE_TIMEOUT,
  )

  it(
    "shares the neutral packages the adapter imports, which the container never lists",
    async () => {
      const root = reportsContainer()

      await build(angularLikeConfig(root, 'production'))

      const shared = readJsonDist<Manifest>(root, 'mf-manifest.json').shared.map(
        share => share.name,
      )
      expect(shared).toEqual(
        expect.arrayContaining(['@company/mfe-angular', '@company/mfe-core', '@company/mfe-runtime']),
      )
    },
    COMPILE_TIMEOUT,
  )

  it(
    'ships the registry entry and the declared defaults, not the copy in public/',
    async () => {
      const root = reportsContainer()

      await build(angularLikeConfig(root, 'production'))

      expect(readJsonDist(root, 'mfe-registry.json')).toMatchObject({ framework: 'angular' })
      expect(existsSync(join(root, 'dist/runtime-config.schema.json'))).toBe(true)
      expect(readJsonDist(root, 'runtime-config.json')).toEqual({ reportLimit: 20 })
    },
    COMPILE_TIMEOUT,
  )

  it(
    "scopes the container's stylesheet, and leaves the component styles Angular encapsulates",
    async () => {
      const root = reportsContainer()

      await build(angularLikeConfig(root, 'production'))

      const css = readdirSync(join(root, 'dist'))
        .filter(name => name.endsWith('.css'))
        .map(name => readDist(root, name))
        .join('\n')
      expect(css).toContain('@scope ([data-mfe-scope="reports"]) to ([data-mfe-scope])')
      // The global stylesheet and the utilities its templates use, compiled together.
      expect(css).toContain('.panel-title')
      expect(css).toContain('.p-4')
      expect(css).not.toContain('.panel-body')

      const component = readdirSync(join(root, 'dist'))
        .filter(name => name.endsWith('.js'))
        .map(name => readDist(root, name))
        .find(source => source.includes('.panel-body'))
      expect(component).toBeDefined()
      expect(component).not.toContain('@scope')
    },
    COMPILE_TIMEOUT,
  )

  it(
    "reports the build's findings as compilation errors",
    async () => {
      const root = reportsContainer({
        'src/stray.ts': `
import { createApp } from '@company/mfe-angular'
export const stray = createApp({ id: 'stray', routes: [] })
`,
      })

      const stats = await build(angularLikeConfig(root, 'production'))

      const [error] = stats.compilation.errors
      expect(stats.compilation.errors).toHaveLength(1)
      expect(error?.name).toBe('MfeBuildError')
      expect(error?.file).toBe(join(root, 'src/stray.ts'))
      expect(error?.message).toContain('every definition to be declared in mfe.ts')
    },
    COMPILE_TIMEOUT,
  )
})

describe('MfeWebpackPlugin across compiles', () => {
  it(
    'regenerates the container before every compile',
    async () => {
      const root = reportsContainer()
      const compiler = webpack(angularLikeConfig(root, 'production'))

      try {
        await run(compiler)
        writeFile(root, 'src/mfe.ts', APP_ENTRY.replace("version: '1.2.0'", "version: '1.3.0'"))
        await run(compiler)
      } finally {
        await close(compiler)
      }

      const registry = readJsonDist<{ definitions: readonly { version: string }[] }>(
        root,
        'mfe-registry.json',
      )
      expect(registry.definitions.map(definition => definition.version)).toEqual(['1.3.0'])
    },
    COMPILE_TIMEOUT,
  )

  it(
    "keeps the developer's public/ copy on a development compile",
    async () => {
      const root = reportsContainer()

      const stats = await build(angularLikeConfig(root, 'development'))

      expect(errorsOf(stats)).toEqual([])
      expect(readJsonDist(root, 'runtime-config.json')).toEqual({ reportLimit: 5 })
    },
    COMPILE_TIMEOUT,
  )

  it(
    'ships the defaults whenever it is told to, whatever the mode',
    async () => {
      const root = reportsContainer()

      await build(angularLikeConfig(root, 'development', { emitRuntimeConfig: true }))

      expect(readJsonDist(root, 'runtime-config.json')).toEqual({ reportLimit: 20 })
    },
    COMPILE_TIMEOUT,
  )
})
