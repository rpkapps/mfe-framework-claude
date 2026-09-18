/**
 * An ordinary Rspack configuration. `mfePlugin()` is a normal plugin rather
 * than a wrapper, so everything here is what it would be in any React project.
 *
 * The plugin owns what makes this a container: definition discovery, the
 * generated `#mfe/*` modules, Module Federation's name, exposes and sharing,
 * the registry descriptor, container-relative asset URLs, scoped CSS and the
 * React Compiler transform. None of that is repeated here, and none of it is
 * configurable per project — a page only works when every container agrees.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mfePlugin } from '@company/mfe-rspack'
import type { Configuration } from '@rspack/core'

const here = dirname(fileURLToPath(import.meta.url))

/** The port is declared once, in the manifest `pnpm dev` reads it from too. */
const manifest = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  readonly mfe: { readonly port: number }
}

export default function config(_env: unknown, argv: { readonly mode?: string }): Configuration {
  const isDev = argv.mode !== 'production'

  return {
    context: here,
    mode: isDev ? 'development' : 'production',
    target: 'browserslist',
    entry: './src/mfe.tsx',

    output: {
      path: resolve(here, 'dist'),
      filename: isDev ? '[name].js' : '[name].[contenthash:8].js',
      chunkFilename: isDev ? '[name].chunk.js' : '[name].[contenthash:8].chunk.js',
      assetModuleFilename: 'assets/[name].[contenthash:8][ext]',
      clean: true,
    },

    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'] },

    module: {
      rules: [
        {
          test: /\.[cm]?tsx?$/,
          exclude: /[\\/]node_modules[\\/]/,
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript', tsx: true },
              transform: { react: { runtime: 'automatic', development: isDev } },
              target: 'es2022',
            },
          },
        },
        { test: /\.css$/, type: 'css' },
        { test: /\.(woff2?|png|svg|jpg|jpeg|gif)$/, type: 'asset/resource' },
      ],
    },

    plugins: [mfePlugin()],

    experiments: { css: true },

    // A dev-server convenience that compiles a chunk the first time the page
    // asks for it, over an endpoint on this server's own origin. A container is
    // loaded by a shell on a different origin, so that request never arrives:
    // the route renders nothing and reports nothing. The CLI turns this on
    // whenever a config leaves it undefined, so a container has to say no.
    lazyCompilation: false,

    devServer: {
      port: manifest.mfe.port,
      // The shell serves the page from its own origin and reads this
      // container's manifest, remote entry and chunks from here, so all of
      // them have to be readable cross-origin.
      headers: { 'Access-Control-Allow-Origin': '*' },
      // A remote is fetched by the shell, never browsed to, so whichever local
      // hostname the developer started the shell on has to be accepted.
      allowedHosts: 'all',
    },

    devtool: isDev ? 'eval-cheap-module-source-map' : 'source-map',

    stats: { preset: 'errors-warnings', assets: true, timings: true },
  }
}
