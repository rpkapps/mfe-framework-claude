/**
 * An ordinary Rsbuild configuration. `pluginMfe()` is a normal plugin rather
 * than a wrapper, so everything here is what it would be in any React project.
 *
 * The plugin owns what makes this a container: definition discovery, the
 * generated `#mfe/*` modules, Module Federation's name, exposes and sharing,
 * the registry descriptor, container-relative asset URLs, scoped CSS and the
 * React Compiler transform. None of that is repeated here, and none of it is
 * configurable per project — a page only works when every container agrees.
 *
 * The one addition is the design system, which is a link to a sibling checkout
 * rather than a published package; `tectonResolve` is the same resolution the
 * shell uses, so the two cannot drift.
 */

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

requireTecton(here, 'The insights container')
useWorkspaceModules(here)

/** The port is declared once, in the manifest `pnpm dev` reads it from too. */
const manifest = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  readonly mfe: { readonly port: number }
}

export default defineConfig({
  plugins: [pluginReact(), pluginMfe()],

  // A remote is fetched by a shell, never browsed to, so it needs no document.
  tools: { htmlPlugin: false, rspack: { resolve: tectonResolve(here) } },

  server: { port: manifest.mfe.port },

  dev: {
    // Compiles a chunk the first time the page asks for it, over an endpoint on
    // this server's own origin. A container is loaded by a shell on a different
    // origin, so that request never arrives: the route renders nothing and
    // reports nothing.
    lazyCompilation: false,
  },
})
