/**
 * Shell build. The shell is the federation *host*: it consumes containers and
 * is never one, so it does not use `pluginMfe()` from @company/mfe-rspack — it
 * only declares a share scope the remotes can join.
 *
 * @tecton/react is a link to a neighbouring checkout, so its TSX is transpiled
 * here rather than excluded as a dependency, and the resolution that needs is
 * shared with every container in `tools/tecton/tecton-build.mjs`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, rspack } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { shared } from '@tecton/react/federation/shared'

import {
  requireTecton,
  tectonResolve,
  useWorkspaceModules,
} from '../../tools/tecton/tecton-build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Fails the config, before a bundler reports the same thing as an unresolvable
// import from whichever file happened to be read first.
requireTecton(here, 'The shell')
useWorkspaceModules(here)

/**
 * The installed version, not the `catalog:` range that package.json holds.
 *
 * Three places to find a manifest, tried in order, because no single one covers
 * every package shared here. `require('<name>/package.json')` needs the
 * package's `exports` map to publish its manifest, and sonner's does not.
 * Resolving the package's entry and walking up to its manifest needs an entry
 * `require` can resolve at all. The link pnpm put in this package's own
 * `node_modules` exists only for a direct dependency, and `@company/mfe-core` —
 * shared here because the shell provides it — is reached through the adapter.
 */
const installedVersion = (name: string): string => {
  const read = (file: string): { name?: string; version: string } =>
    JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version: string }

  try {
    return (require(`${name}/package.json`) as { version: string }).version
  } catch {
    // Not published by the exports map; the entry below usually is.
  }

  try {
    let directory = dirname(require.resolve(name))
    for (;;) {
      const file = join(directory, 'package.json')
      if (existsSync(file)) {
        const manifest = read(file)
        if (manifest.name === name) return manifest.version
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  } catch {
    // No requirable entry either; the direct link is the last place to look.
  }

  return read(resolve(here, 'node_modules', name, 'package.json')).version
}

/**
 * The same, for a package the shell may not have at all. A share it cannot
 * resolve is one it cannot provide, so the entry is dropped rather than
 * advertised against a version nothing here could serve.
 */
const installedVersionOrNone = (name: string): string | undefined => {
  try {
    return installedVersion(name)
  } catch {
    return undefined
  }
}

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

/**
 * The design system's dependencies, as its own contract states them: which of
 * them the page may hold two copies of, and which must never be eager. The
 * reason per entry is in `@tecton/react/federation/shared`; the versions are
 * the shell's own install, which the library cannot see. `strictVersion`
 * follows `singleton` — a mismatch is an error exactly where a second copy
 * would be.
 *
 * A contract entry the shell has not installed (recharts: only a container
 * that charts pulls it in) has no copy here to offer, so it is left out rather
 * than advertised as one.
 */
const designSystemShares = Object.fromEntries(
  Object.entries(shared).flatMap(([candidate, policy]) => {
    // A trailing slash shares every subpath of a package that publishes no
    // root export, and the package is what a version is read from.
    const prefix = candidate.endsWith('/')
    const version = installedVersionOrNone(prefix ? candidate.slice(0, -1) : candidate)
    if (version === undefined) return []

    return [
      [
        candidate,
        {
          singleton: policy.singleton,
          strictVersion: policy.singleton,
          ...(policy.eager === false ? { eager: false } : {}),
          requiredVersion: version,
          // Module Federation reads a share's version from its package.json,
          // which it cannot do for a prefix: no package is literally named
          // "@tecton/react/", so this one states it.
          ...(prefix ? { version } : {}),
        },
      ],
    ]
  }),
)

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
        // "rendered outside any mount". The router and the query client carry
        // their own, and a boundary route reads all of them.
        '@company/mfe-core': strictSingleton('@company/mfe-core'),
        '@company/mfe-host': strictSingleton('@company/mfe-host'),
        '@company/mfe-react': strictSingleton('@company/mfe-react'),
        '@tanstack/react-router': strictSingleton('@tanstack/react-router'),
        '@tanstack/react-query': strictSingleton('@tanstack/react-query'),
        // React, the design system and what it holds module state in: the
        // contract's entries, on this install's versions.
        ...designSystemShares,
      },
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
