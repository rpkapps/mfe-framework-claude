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

/**
 * Read at build time, so sign-in can start before any request of its own; every name is defined
 * even when unset, because the entry reads each one (§36).
 */
const DEFINED_ENV = [
  'FARO_URL',
  'OIDC_AUTHORITY',
  'OIDC_CLIENT_ID',
  'OIDC_SCOPE',
  'OIDC_GROUPS_CLAIM',
  'OIDC_DISABLED',
] as const

/** The origin the entry fetches discovery from and then navigates to, when sign-in is on. */
function identityProviderOrigin(): string | undefined {
  const authority = process.env['OIDC_AUTHORITY']?.trim()
  if (authority === undefined || authority === '' || process.env['OIDC_DISABLED'] === 'true') {
    return undefined
  }
  try {
    return new URL(authority).origin
  } catch {
    // The entry reports a malformed authority on the page; the hint is simply left out.
    return undefined
  }
}

const providerOrigin = identityProviderOrigin()

export default defineConfig({
  plugins: [pluginReact()],

  // Rsbuild names the generated document after its entry, so any other name serves the shell at /<name>.
  source: { entry: { index: './src/index.tsx' } },

  html: {
    template: './src/index.html',
    // The connection to the identity provider opens while the entry downloads: once for the
    // discovery fetch, which is CORS, and once for the navigation, which is not.
    tags:
      providerOrigin === undefined
        ? []
        : [
            {
              tag: 'link',
              attrs: { rel: 'preconnect', href: providerOrigin, crossorigin: '' },
              head: true,
              append: false,
            },
            {
              tag: 'link',
              attrs: { rel: 'preconnect', href: providerOrigin },
              head: true,
              append: false,
            },
          ],
  },

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
            DEFINED_ENV.flatMap(name => {
              const value = JSON.stringify(process.env[name] ?? '')
              return [
                [`process.env.${name}`, value],
                [`process.env['${name}']`, value],
              ]
            }),
          ),
        ),
      ],
    },
  },
})
