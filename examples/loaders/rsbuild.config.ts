/**
 * An ordinary container configuration, as the other examples' are. The one addition generates
 * `src/generated/loaders.js` from the shell's loaders when the configuration loads, and restarts
 * the dev server when a loader changes, so the gallery always shows what the shell would draw.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pluginMfe } from '@company/mfe-rspack'
import { defineConfig, type RsbuildPlugin } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

import {
  requireTecton,
  tectonResolve,
  useWorkspaceModules,
} from '../../tools/tecton/tecton-build.mjs'
import { generateLoaders, SHELL_LOADERS } from './scripts/generate-loaders.ts'

const here = dirname(fileURLToPath(import.meta.url))

requireTecton(here, 'The loaders gallery')
useWorkspaceModules(here)

/** The port is declared once, in the manifest `pnpm dev` reads it from too. */
const manifest = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  readonly mfe: { readonly port: number }
}

const pluginGalleryLoaders: RsbuildPlugin = {
  name: 'gallery-loaders',
  setup(api) {
    api.modifyRsbuildConfig(async (config, { mergeRsbuildConfig }) => {
      await generateLoaders()
      return mergeRsbuildConfig(config, {
        dev: { watchFiles: { paths: [SHELL_LOADERS], type: 'reload-server' } },
      })
    })
  },
}

export default defineConfig({
  plugins: [pluginReact(), pluginMfe(), pluginGalleryLoaders],

  // A remote is fetched by a shell, never browsed to, so it needs no document; `tectonResolve` is
  // the shell's own resolution of the design system, so the two cannot drift.
  tools: { htmlPlugin: false, rspack: { resolve: tectonResolve(here) } },

  server: { port: manifest.mfe.port },

  dev: {
    // Lazy compilation serves chunks from this server's own origin, so a shell on another origin
    // makes a request that never arrives and nothing reports it (§12).
    lazyCompilation: false,
  },
})
