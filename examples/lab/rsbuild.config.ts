/** `pluginMfe()` is one entry in `plugins` and never replaces the configuration (§13); what it
 * owns is absent from this file and is not configurable per project. */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pluginMfe } from '@company/mfe-rspack'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

import {
  requireTecton,
  tectonResolve,
  useWorkspaceModules,
} from '../../tools/tecton/tecton-build.mjs'

const here = dirname(fileURLToPath(import.meta.url))

requireTecton(here, 'The framework lab App')
useWorkspaceModules(here)

/** The port is declared once, in the manifest `pnpm dev` reads it from too. */
const manifest = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  readonly mfe: { readonly port: number }
}

export default defineConfig({
  plugins: [pluginReact(), pluginMfe()],

  // A remote is fetched by a shell, never browsed to, so it needs no document; `tectonResolve` is
  // the shell's own resolution of the design system, so the two cannot drift.
  tools: { htmlPlugin: false, rspack: { resolve: tectonResolve(here) } },

  server: {
    port: manifest.mfe.port,
    // A deployment's runtime-config.json is never built into the container, so in development this
    // server publishes the container's own copy where the generated loader resolves it from.
    publicDir: { name: 'public' },
  },

  dev: {
    // Lazy compilation serves chunks from this server's own origin, so a shell on another origin
    // makes a request that never arrives and nothing reports it (§12).
    lazyCompilation: false,
  },
})
