/**
 * Shell build. The shell is the federation *host*: it consumes containers and
 * is never one, so it does not use `pluginMfe()` from @company/mfe-rspack — it
 * only declares a share scope the remotes can join.
 *
 * @tecton/react is a link to a neighbouring checkout with no node_modules of
 * its own, which is why `resolve.modules` and `NODE_PATH` below name this
 * workspace's directories absolutely, and why its TSX is transpiled here rather
 * than excluded as a dependency.
 */

import { createRequire } from 'node:module'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, rspack } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/**
 * Tailwind resolves a stylesheet's `@import`s from that stylesheet's own
 * location, and adds `NODE_PATH` to its module directories. Set here rather
 * than in the scripts: cross-platform, and before Tailwind reads it.
 */
process.env['NODE_PATH'] = [
  resolve(here, 'node_modules'),
  resolve(here, '../../node_modules'),
  ...(process.env['NODE_PATH'] === undefined ? [] : [process.env['NODE_PATH']]),
].join(delimiter)

/** The installed version, not the `catalog:` range that package.json holds. */
const installedVersion = (name: string): string =>
  (require(`${name}/package.json`) as { version: string }).version

const DEV_PORT = 3000

/**
 * A remote that resolves its own React would give the page a second renderer,
 * so a version mismatch is an error rather than a silent duplicate.
 */
const strictSingleton = (name: string) => ({
  singleton: true,
  strictVersion: true,
  requiredVersion: installedVersion(name),
})

export default defineConfig({
  plugins: [pluginReact()],

  // Named `index` deliberately: Rsbuild names the generated document after its
  // entry, so any other name serves the shell at /<name> and every deep link
  // below a boundary 404s.
  source: { entry: { index: './src/index.tsx' } },

  html: { template: './src/index.html' },

  moduleFederation: {
    options: {
      name: 'shell',
      // No static remotes: each one is registered at runtime from the registry,
      // after developer overrides were applied.
      remotes: {},
      shared: {
        // The framework packages carry React context across the boundary, so a
        // second copy in a container makes every framework hook fail with
        // "rendered outside any mount". They are shared for the same reason
        // React is.
        '@company/mfe-core': strictSingleton('@company/mfe-core'),
        '@company/mfe-host': strictSingleton('@company/mfe-host'),
        '@company/mfe-react': strictSingleton('@company/mfe-react'),
        // The trailing slash shares every subpath of the design system, which
        // is how it is imported; it publishes no root entry.
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
    },
  },

  server: {
    port: DEV_PORT,
    // Deep links below a boundary belong to the mounted App, so every unknown
    // path has to return the shell document.
    historyApiFallback: true,
    publicDir: { name: 'public' },
  },

  tools: {
    rspack: {
      resolve: {
        // Symlinks stay resolved, so every other package still finds its own
        // transitive dependencies the way pnpm's layout expects.
        modules: [
          'node_modules',
          resolve(here, 'node_modules'),
          resolve(here, '../../node_modules'),
        ],
      },
      plugins: [
        // `process` does not exist in a browser, so every `process.env.X` the
        // shell reads has to be substituted here or it survives into the bundle
        // and throws on boot. Both forms are defined because TypeScript's
        // index-signature rule makes the source write the bracket one.
        new rspack.DefinePlugin(
          Object.fromEntries(
            [['FARO_URL', process.env['FARO_URL'] ?? '']].flatMap(([name, value]) => [
              [`process.env.${String(name)}`, JSON.stringify(value)],
              [`process.env['${String(name)}']`, JSON.stringify(value)],
            ]),
          ),
        ),
      ],
    },
  },
})
