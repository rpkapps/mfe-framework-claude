/**
 * Real webpack compiles of a small Angular-shaped container. The configuration stands in for what
 * Angular's builder hands `withMfe()`: an application and a polyfills entry, an empty public path,
 * module scripts, a runtime chunk, no top-level await, and its global- and component-style rules,
 * which only compile a stylesheet whose request carries `?ngGlobalStyle` or `?ngResource`.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'

import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import { afterEach, describe, expect, it } from 'vitest'
import webpack, {
  type Compilation,
  type Compiler,
  type Configuration,
  type Stats,
  type WebpackPluginInstance,
} from 'webpack'

import { seedLocalRuntimeConfig } from '@company/mfe-build'

import {
  ANGULAR_CORE_VERSION,
  cleanupContainers,
  createContainer,
  writeFile,
} from '../testing/containers.ts'
import type { MfeAngularOptions } from '../options.ts'
import { planContainer } from '../plan.ts'
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

export const template = '<section class="panel-body">Panel</section>'

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
    { link: ['zod'] },
  )
}

/** Stands in for Angular's own asset copy: every file in `public/`, beside the compiled output. */
class CopiedPublicDir implements WebpackPluginInstance {
  constructor(private readonly root: string) {}

  apply(compiler: Compiler): void {
    const publicDir = join(this.root, 'public')
    compiler.hooks.thisCompilation.tap('CopiedPublicDir', (compilation: Compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'CopiedPublicDir',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          if (!existsSync(publicDir)) return
          for (const name of readdirSync(publicDir, { recursive: true, encoding: 'utf8' })) {
            const file = join(publicDir, name)
            if (!statSync(file).isFile()) continue
            compilation.emitAsset(
              name.split(sep).join('/'),
              new compiler.webpack.sources.RawSource(readFileSync(file)),
            )
          }
        },
      )
    })
  }
}

/** Seeds the developer's copy wherever the generate step keeps it, then edits in a laptop's value. */
function giveLocalValues(root: string, options: MfeAngularOptions): void {
  const local = seedLocalRuntimeConfig(planContainer({ ...options, containerRoot: root }))
  if (local === null) throw new Error('The fixture declares no configuration to seed.')
  writeFileSync(local.path, '{ "reportLimit": 5, "apiBaseUrl": "http://localhost:3010/api/" }\n')
}

function angularLikeConfig(
  root: string,
  mode: 'production' | 'development',
  settings: MfeWebpackPluginSettings = {},
  options: MfeAngularOptions = {},
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
      // The framework packages' TypeScript source, as everywhere in this repository
      // (tools/workspace/conditions.mjs).
      conditionNames: ['...', 'mfe-source'],
      // The container's `env` import, from this package's own source.
      alias: { '@company/mfe-nx/env': join(__dirname, '../env.ts') },
    },
    module: {
      rules: [
        // The federation runtime writes its entry under the working directory's node_modules.
        // Angular's builder runs in the workspace root, which declares no module type; these
        // tests run in this CommonJS package, whose type would make that ES module unreadable.
        { test: /[\\/]node_modules[\\/]\.federation[\\/]/, type: 'javascript/auto' },
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
      new CopiedPublicDir(root),
      new MfeWebpackPlugin({ ...options, containerRoot: root }, settings),
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

const ANGULAR_SCOPE = `angular@${ANGULAR_CORE_VERSION}`

/** Each share the remote entry registers at start-up, with the one scope it registers it in. */
function registeredScopes(remoteEntry: string): Record<string, string> {
  const block = /initOptions\.shared = \{([\s\S]*?)\n[^\n]*\};/.exec(remoteEntry)?.[1] ?? ''
  const shares = block.matchAll(/"([^"]+)": \[\{[\s\S]*?scope: \["([^"]+)"\]/g)
  return Object.fromEntries([...shares].map(([, name = '', scope = '']) => [name, scope]))
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
      // src/main.ts nor src/polyfills.ts exists, so compiling either would have failed. The other
      // entry point is the federation container, named after the package.
      expect([...stats.compilation.entrypoints.keys()].sort()).toEqual(['acme_reports', 'main'])

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
    'shares the neutral packages the adapter imports, which the container never lists',
    async () => {
      const root = reportsContainer()

      await build(angularLikeConfig(root, 'production'))

      const shared = readJsonDist<Manifest>(root, 'mf-manifest.json').shared.map(
        share => share.name,
      )
      expect(shared).toEqual(
        expect.arrayContaining([
          '@company/mfe-angular',
          '@company/mfe-core',
          '@company/mfe-runtime',
        ]),
      )
    },
    COMPILE_TIMEOUT,
  )

  it(
    'registers the Angular group in the Angular scope and the neutral packages in the page scope',
    async () => {
      const root = reportsContainer()

      await build(angularLikeConfig(root, 'production'))

      const registry = readJsonDist<{ shareScopes?: unknown }>(root, 'mfe-registry.json')
      expect(registry.shareScopes).toEqual(['default', ANGULAR_SCOPE])
      // The manifest names no scope, so the scope is read where the remote registers its shares.
      expect(registeredScopes(readDist(root, 'remoteEntry.js'))).toEqual({
        '@company/mfe-angular': ANGULAR_SCOPE,
        '@company/mfe-core': 'default',
        '@company/mfe-runtime': 'default',
      })
    },
    COMPILE_TIMEOUT,
  )

  it(
    'ships the registry entry and the declared defaults as the runtime configuration',
    async () => {
      const root = reportsContainer()

      await build(angularLikeConfig(root, 'production'))

      expect(readJsonDist(root, 'mfe-registry.json')).toMatchObject({ framework: 'angular' })
      expect(existsSync(join(root, 'dist/runtime-config.schema.json'))).toBe(true)
      expect(readJsonDist(root, 'runtime-config.json')).toEqual({ reportLimit: 20 })
    },
    COMPILE_TIMEOUT,
  )

  it.each([
    { named: 'runtime-config.json', options: {} },
    { named: 'settings.json', options: { runtimeConfigFileName: 'settings.json' } },
  ])(
    "ships the declared defaults as $named, and none of the developer's values",
    async ({ named, options }) => {
      const root = reportsContainer({ 'public/robots.txt': 'User-agent: *\n' })
      giveLocalValues(root, options)

      await build(angularLikeConfig(root, 'production', {}, options))

      expect(readJsonDist(root, named)).toEqual({ reportLimit: 20 })
      // public/ is still copied; the developer's file is simply not in it.
      expect(readDist(root, 'robots.txt')).toBe('User-agent: *\n')
      const shipped = readdirSync(join(root, 'dist'), { recursive: true, encoding: 'utf8' })
        .filter(name => statSync(join(root, 'dist', name)).isFile())
        .map(name => readDist(root, name))
      expect(shipped.filter(contents => contents.includes('localhost:3010'))).toEqual([])
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
      // Global styles are scoped; Angular's encapsulated component styles stay separate.
      expect(css).toContain('.panel-title')
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
    'scopes nested global CSS imports',
    async () => {
      const root = reportsContainer({
        'src/styles.css': '@import "./open-props/props.shadows.css";\n',
        'src/open-props/props.shadows.css':
          '@import "props.media.css";\n:where(html) { --shadow-size: 1rem; }\n.shadow { box-shadow: none; }\n',
        'src/open-props/props.media.css': '.media { margin: 0; }\n',
      })

      const stats = await build(angularLikeConfig(root, 'production'))

      expect(errorsOf(stats)).toEqual([])
      const css = readdirSync(join(root, 'dist'))
        .filter(name => name.endsWith('.css'))
        .map(name => readDist(root, name))
        .join('\n')
      expect(css).toContain('@scope ([data-mfe-scope="reports"]) to ([data-mfe-scope])')
      expect(css).toContain('.shadow')
      expect(css).toContain('.media')
      expect(css).toContain(':where(:scope)')
      expect(css).not.toContain('.p-4')
    },
    COMPILE_TIMEOUT,
  )

  it(
    'keeps the url() references, layers and supports conditions of an inlined import',
    async () => {
      const root = reportsContainer({
        'src/styles.css': [
          '@import "./theme/fonts.css";',
          '@import "./theme/base.css" layer(base);',
          '@import "./theme/grid.css" supports(display: grid);',
          '',
        ].join('\n'),
        'src/theme/fonts.css':
          '@font-face { font-family: Brand; src: url(./brand.woff2) format("woff2"); }\n',
        'src/theme/brand.woff2': 'font',
        'src/theme/base.css': '.base-card { color: red; }\n',
        'src/theme/grid.css': '.grid-card { display: grid; }\n',
      })

      const stats = await build(angularLikeConfig(root, 'production'))

      // Left relative to src/theme/, the font would resolve from the generated stylesheet's
      // directory and fail the build.
      expect(errorsOf(stats)).toEqual([])
      const css = readdirSync(join(root, 'dist'))
        .filter(name => name.endsWith('.css'))
        .map(name => readDist(root, name))
        .join('\n')
      expect(css).toMatch(/src: url\([^)]+\.woff2\)/)
      expect(css).toMatch(/@layer base\s*\{[^}]*\.base-card/)
      expect(css).toMatch(/@supports \(display: grid\)\s*\{[^}]*\.grid-card/)
      expect(css).not.toContain('@media layer(')
      expect(css).not.toContain('@media supports(')
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
    'leaves the runtime configuration to the dev server on a development compile',
    async () => {
      const root = reportsContainer({ '.mfe/runtime-config.json': '{ "reportLimit": 5 }\n' })

      const stats = await build(angularLikeConfig(root, 'development'))

      expect(errorsOf(stats)).toEqual([])
      expect(existsSync(join(root, 'dist/runtime-config.json'))).toBe(false)
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
