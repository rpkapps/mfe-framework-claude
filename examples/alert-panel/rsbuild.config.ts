/**
 * An ordinary Rsbuild configuration. `pluginMfe()` is a normal plugin rather
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

import { pluginMfe } from '@company/mfe-rspack'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))

/** The port is declared once, in the manifest `pnpm dev` reads it from too. */
const manifest = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  readonly mfe: { readonly port: number }
}

export default defineConfig({
  // pluginReact supplies the automatic JSX runtime and Fast Refresh; pluginMfe
  // supplies everything that makes this project a container.
  plugins: [pluginReact(), pluginMfe()],

  source: { entry: { index: './src/mfe.tsx' } },

  // A remote is fetched by a shell, never browsed to, so it needs no document.
  tools: { htmlPlugin: false },

  server: {
    port: manifest.mfe.port,
    // The shell serves the page from its own origin and reads this container's
    // manifest, remote entry and chunks from here.
    cors: true,
  },

  dev: {
    // Compiles a chunk the first time the page asks for it, over an endpoint on
    // this server's own origin. A container is loaded by a shell on a different
    // origin, so that request never arrives: the route renders nothing and
    // reports nothing.
    lazyCompilation: false,
  },
})
