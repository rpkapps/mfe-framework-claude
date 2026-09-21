/**
 * The shell is the federation host, never a container, so it asks `@company/mfe-rspack/federation`
 * for its share scope instead of resolving a second one (§27).
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, rspack } from '@rsbuild/core'
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

export default defineConfig({
  plugins: [pluginReact()],

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
