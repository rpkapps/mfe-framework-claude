// @ts-check
/**
 * Shell build. The shell is the federation *host*: it consumes remote
 * containers and is never itself a container, so it does not use `mfePlugin()`
 * from @company/mfe-rspack. It only needs a share scope the remotes can join.
 *
 * Two settings carry the @tecton/react integration:
 *
 *  - `resolve.symlinks: false` keeps the design system's files addressed
 *    through `node_modules/@tecton/react/...` instead of their real path in the
 *    neighbouring checkout. That matters twice over: bare imports inside the
 *    package (react, react-aria-components, tailwindcss) then resolve upwards
 *    into *this* workspace's node_modules, and React stays a single copy.
 *  - the TypeScript rule has no `node_modules` exclusion, because @tecton/react
 *    ships unbuilt TSX and this build is what transpiles it.
 */

import { createRequire } from 'node:module'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import rspack from '@rspack/core'
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack'
import ReactRefreshPlugin from '@rspack/plugin-react-refresh'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/**
 * Tailwind resolves the `@import`s it finds *inside* a stylesheet from that
 * stylesheet's real location, and the design system's real location is a
 * neighbouring checkout with no node_modules of its own. Tailwind's resolver
 * adds `NODE_PATH` to its module directories, so pointing it back at this
 * workspace is what lets `globals.css` find `tailwindcss`, `tw-animate-css`,
 * `shadcn/tailwind.css` and the font packages. Set here rather than in the
 * scripts so it works the same on every platform, and before the build starts,
 * which is when Tailwind reads it.
 */
process.env.NODE_PATH = [
  resolve(here, 'node_modules'),
  resolve(here, '../../node_modules'),
  ...(process.env.NODE_PATH ? [process.env.NODE_PATH] : []),
].join(delimiter)

/** @type {{ dependencies: Record<string, string> }} */
const pkg = require('./package.json')

const DEV_PORT = 3000

/**
 * Strict singletons. A remote that resolves its own React would give the page a
 * second renderer, and a second copy of the design system would give it a
 * second set of React Aria contexts, so both are pinned to the host's copy and
 * a version mismatch is an error rather than a silent duplicate.
 *
 * `@tecton/react/` (with the trailing slash) shares every subpath of the design
 * system, which is how it is imported: the package publishes no root entry.
 */
const strictSingleton = (/** @type {string} */ requiredVersion) => ({
  singleton: true,
  strictVersion: true,
  requiredVersion,
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
      // See the file header: this is what makes the linked design system
      // resolve its peers against this workspace.
      symlinks: false,
    },

    module: {
      rules: [
        {
          // No node_modules exclusion on purpose: @tecton/react and the
          // @company/mfe-* packages are consumed as TypeScript source.
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
      new ModuleFederationPlugin({
        name: 'shell',
        // The host declares no static remotes: every remote is registered at
        // runtime from the registry, after developer overrides were applied.
        remotes: {},
        shared: {
          react: strictSingleton(pkg.dependencies.react),
          'react-dom': strictSingleton(pkg.dependencies['react-dom']),
          '@tanstack/react-router': strictSingleton(pkg.dependencies['@tanstack/react-router']),
          '@tanstack/react-query': strictSingleton(pkg.dependencies['@tanstack/react-query']),
          '@tecton/react/': {
            singleton: true,
            strictVersion: true,
            version: '0.0.0',
            requiredVersion: '0.0.0',
          },
        },
      }),
      isDev ? new ReactRefreshPlugin() : null,
    ].filter(Boolean),

    experiments: { css: true },

    devServer: {
      port: DEV_PORT,
      // Deep links such as /orion-discovery/wells/42 belong to the mounted App,
      // so every unknown path has to return the shell document.
      historyApiFallback: true,
      hot: true,
      static: { directory: resolve(here, 'public'), publicPath: '/' },
      client: { overlay: { errors: true, warnings: false } },
    },

    devtool: isDev ? 'eval-cheap-module-source-map' : 'source-map',

    stats: { preset: 'errors-warnings', assets: true, timings: true },
  }
}
