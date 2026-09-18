// @ts-check
/**
 * Shell build. The shell is the federation *host*: it consumes containers and
 * is never one, so it does not use `mfePlugin()` from @company/mfe-rspack — it
 * only needs a share scope the remotes can join.
 *
 * @tecton/react is a link to a neighbouring checkout with no node_modules of
 * its own, which is why `resolve.modules` and `NODE_PATH` below name this
 * workspace's directories absolutely, and why the TypeScript rule has no
 * node_modules exclusion: this build is what transpiles its TSX.
 */

import { createRequire } from 'node:module'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import rspack from '@rspack/core'
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import { ReactRefreshRspackPlugin } from '@rspack/plugin-react-refresh'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/**
 * Tailwind resolves a stylesheet's `@import`s from that stylesheet's own
 * location, and adds `NODE_PATH` to its module directories. Set here rather
 * than in the scripts: cross-platform, and before Tailwind reads it.
 */
process.env.NODE_PATH = [
  resolve(here, 'node_modules'),
  resolve(here, '../../node_modules'),
  ...(process.env.NODE_PATH ? [process.env.NODE_PATH] : []),
].join(delimiter)

/** The installed version, not the `catalog:` range that package.json holds. */
const installedVersion = (/** @type {string} */ name) =>
  /** @type {{ version: string }} */ (require(`${name}/package.json`)).version

const DEV_PORT = 3000

/**
 * A remote that resolves its own React would give the page a second renderer,
 * so a version mismatch is an error rather than a silent duplicate.
 */
const strictSingleton = (/** @type {string} */ name) => ({
  singleton: true,
  strictVersion: true,
  requiredVersion: installedVersion(name),
})

export default function config(_env, argv) {
  const isDev = argv?.mode !== 'production'

  return {
    context: here,
    mode: isDev ? 'development' : 'production',
    target: 'browserslist',
    entry: { shell: './src/index.tsx' },

    output: {
      path: resolve(here, 'dist'),
      publicPath: '/',
      filename: isDev ? '[name].js' : '[name].[contenthash:8].js',
      chunkFilename: isDev ? '[name].chunk.js' : '[name].[contenthash:8].chunk.js',
      assetModuleFilename: 'assets/[name].[contenthash:8][ext]',
      clean: true,
    },

    resolve: {
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
      // Symlinks stay resolved, so every other package still finds its own
      // transitive dependencies the way pnpm's layout expects.
      modules: ['node_modules', resolve(here, 'node_modules'), resolve(here, '../../node_modules')],
    },

    module: {
      rules: [
        {
          test: /\.[cm]?tsx?$/,
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript', tsx: true },
              transform: {
                react: {
                  runtime: 'automatic',
                  development: isDev,
                  refresh: isDev,
                },
              },
              target: 'es2022',
            },
          },
        },
        {
          test: /\.css$/,
          type: 'css',
          use: [
            {
              loader: 'postcss-loader',
              options: { postcssOptions: { config: resolve(here, 'postcss.config.mjs') } },
            },
          ],
        },
        {
          test: /\.(woff2?|png|svg|jpg|jpeg|gif)$/,
          type: 'asset/resource',
        },
      ],
    },

    plugins: [
      new rspack.HtmlRspackPlugin({
        template: './src/index.html',
        title: 'Discovery',
      }),
      new rspack.CopyRspackPlugin({
        patterns: [{ from: 'public', to: '.' }],
      }),
      // `process` does not exist in a browser, so every `process.env.X` the
      // shell reads has to be substituted here or it survives into the bundle
      // and throws on boot. Both forms are defined because TypeScript's
      // index-signature rule makes the source write the bracket one.
      new rspack.DefinePlugin(
        Object.fromEntries(
          [
            ['FARO_URL', process.env.FARO_URL ?? ''],
            ['NODE_ENV', isDev ? 'development' : 'production'],
          ].flatMap(([name, value]) => [
            [`process.env.${name}`, JSON.stringify(value)],
            [`process.env['${name}']`, JSON.stringify(value)],
          ]),
        ),
      ),
      new ModuleFederationPlugin({
        name: 'shell',
        // No static remotes: each one is registered at runtime from the
        // registry, after developer overrides were applied.
        remotes: {},
        shared: {
          // The trailing slash shares every subpath of the design system,
          // which is how it is imported; it publishes no root entry.
          react: strictSingleton('react'),
          'react-dom': strictSingleton('react-dom'),
          '@tanstack/react-router': strictSingleton('@tanstack/react-router'),
          '@tanstack/react-query': strictSingleton('@tanstack/react-query'),
          '@tecton/react/': {
            singleton: true,
            strictVersion: true,
            version: '0.0.0',
            requiredVersion: '0.0.0',
          },
        },
      }),
      isDev ? new ReactRefreshRspackPlugin() : null,
    ].filter(Boolean),

    experiments: { css: true },

    devServer: {
      port: DEV_PORT,
      // Deep links below a boundary belong to the mounted App, so every unknown
      // path has to return the shell document.
      historyApiFallback: true,
      hot: true,
      static: { directory: resolve(here, 'public'), publicPath: '/' },
      client: { overlay: { errors: true, warnings: false } },
    },

    devtool: isDev ? 'eval-cheap-module-source-map' : 'source-map',

    stats: { preset: 'errors-warnings', assets: true, timings: true },
  }
}
