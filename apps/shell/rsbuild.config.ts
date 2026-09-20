/**
 * Shell build. The shell is the federation *host*: it consumes containers and
 * is never one, so it does not use `pluginMfe()` from @company/mfe-rspack — it
 * only declares a share scope the remotes can join, which it asks that package
 * for rather than writing out a second time.
 *
 * @tecton/react is a link to a neighbouring checkout, so its TSX is transpiled
 * here rather than excluded as a dependency, and the resolution that needs is
 * shared with every container in `tools/tecton/tecton-build.mjs`.
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

// Fails the config, before a bundler reports the same thing as an unresolvable
// import from whichever file happened to be read first.
requireTecton(here, 'The shell')
useWorkspaceModules(here)

const DEV_PORT = 3000

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
      // The one part of this build a container also has, and the one part both
      // sides have to agree on: which packages the page holds a single copy of,
      // on which version, and how a share in that scope is resolved. Asked of
      // the build integration rather than restated here, so the framework's
      // candidates and the design system's published contract reach the shell
      // and its remotes together. The versions are this install's — the copies
      // the shell actually puts into the scope.
      ...hostFederation({ root: here }),
    },
  },

  dev: {
    // Lazy compilation wraps the entry in a proxy module that is not a React
    // Refresh boundary, so every hot update propagated through it to the entry
    // and came back as a full page reload. The containers disable it for a
    // different reason (their chunks are requested cross-origin); the effect
    // here is that editing a component updates that component.
    lazyCompilation: false,
  },

  server: {
    port: DEV_PORT,
    // The address a developer opens and every override snippet names. Moving
    // it silently would point all of them at nothing.
    strictPort: true,
    // Deep links below a boundary belong to the mounted App, so every unknown
    // path has to return the shell document.
    historyApiFallback: true,
    publicDir: { name: 'public' },
  },

  tools: {
    rspack: {
      resolve: tectonResolve(here),
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
