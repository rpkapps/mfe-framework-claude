/**
 * The shell is the federation host, never a container, so it asks `@company/mfe-rspack/federation`
 * for its share scope instead of resolving a second one (§27).
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, rspack, type RsbuildPlugin } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

import { hostFederation } from '@company/mfe-rspack/federation'

import {
  requireTecton,
  tectonResolve,
  useWorkspaceModules,
} from '../../tools/tecton/tecton-build.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Fails the config, before a bundler reports it as an unresolvable import from an arbitrary file.
requireTecton(here, 'The shell')
useWorkspaceModules(here)

const DEV_PORT = 3000

/**
 * The developer's own runtime configuration, answered at the URL a deployment publishes
 * `runtime-config.json` at, as a container's dev server does. It lives in `.mfe/`, which no build
 * copies, and is read on every request, so an edit reaches the next page load (§36).
 */
function pluginLocalRuntimeConfig(): RsbuildPlugin {
  const file = join(here, '.mfe', 'runtime-config.json')
  return {
    name: 'shell-local-runtime-config',
    setup(api) {
      api.onBeforeStartDevServer(({ server }) => {
        server.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
          if (request.method !== 'GET' || pathname !== '/runtime-config.json') {
            next()
            return
          }
          readFile(file).then(
            body => {
              response.setHeader('Content-Type', 'application/json; charset=utf-8')
              response.setHeader('Cache-Control', 'no-store')
              response.end(body)
            },
            // No file is a 404, which the page reports as a configuration it could not load.
            () => {
              next()
            },
          )
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [pluginReact(), pluginLocalRuntimeConfig()],

  // Rsbuild names the generated document after its entry, so any other name serves the shell at /<name>.
  source: { entry: { index: './src/index.tsx' } },

  html: { template: './src/index.html' },

  moduleFederation: {
    options: {
      name: 'shell',
      // Registered at runtime from the registry, after developer overrides were applied.
      remotes: {},
      // One share scope and strategy for the shell and its remotes, resolved once here (§27, §30).
      ...hostFederation({ root: here }),
    },
  },

  dev: {
    // Lazy compilation wraps the entry in a proxy module that is not a React Refresh boundary (§18).
    lazyCompilation: false,
  },

  server: {
    port: DEV_PORT,
    // Every override snippet names this address, so moving it silently would point them at nothing.
    strictPort: true,
    // Deep links below a boundary belong to the mounted App, so every unknown path returns the shell document.
    historyApiFallback: true,
    publicDir: { name: 'public' },
  },

  tools: {
    rspack: {
      resolve: tectonResolve(here),
      plugins: [
        // Both forms are defined because TypeScript's index-signature rule makes the source write the bracket one.
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
