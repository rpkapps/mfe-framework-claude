import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

import { diagrams } from './src/vite/diagrams.ts'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * Every directory a `link:`ed package's own files can be served from.
 *
 * `@tecton/react` lives in a checkout beside this repository, so its real path is outside this
 * workspace and `server.fs.allow` refuses it: in dev the stylesheet loads but the `@fontsource`
 * files it `@import`s come back 403 and the page falls back to a system font. Resolving the
 * package rather than naming the sibling directory keeps this true wherever the checkout sits.
 *
 * The package's own `node_modules` holds its direct dependencies and the checkout root holds the
 * pnpm store they link into, so every ancestor that has a `node_modules` is allowed.
 */
function linkedPackageRoots(specifier: string): string[] {
  const require = createRequire(import.meta.url)
  let directory: string
  try {
    directory = dirname(realpathSync(require.resolve(`${specifier}/package.json`)))
  } catch {
    // A dangling link: the bundler reports the unresolved import on its own.
    return []
  }

  const roots: string[] = []
  const { root } = parse(directory)
  for (let current = directory; current !== root; current = dirname(current)) {
    if (existsSync(join(current, 'node_modules'))) roots.push(current)
  }
  return roots
}

/**
 * Every page of the site, listed so a broken link cannot silently drop one from the build.
 * `crawlLinks` stays on as the safety net for anything added later.
 */
const GUIDES = [
  'shape',
  'declaring',
  'config-and-data',
  'what-the-shell-gives-you',
  'what-you-must-not-do',
  'lifecycle',
  'storage',
  'styling',
  'daily-workflow',
  'shipping-and-failures',
]

const PAGES = [
  '/',
  '/docs',
  '/docs/design',
  ...GUIDES.map(name => `/docs/guides/${name}`),
  '/docs/glossary',
  '/docs/decisions',
  // Not a page: the exported search index, written to `api/search` in the client output.
  '/api/search',
]

export default defineConfig({
  server: {
    port: Number(process.env['PORT']) || 3020,
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...linkedPackageRoots('@tecton/react')] },
  },
  // The prerender crawler fetches every page from a preview server in the same process. Binding it
  // to IPv4 avoids Node's fetch racing ::1 against 127.0.0.1.
  preview: { host: '127.0.0.1' },

  resolve: {
    alias: [{ find: '@', replacement: here('./src') }],
    /*
     * `@tecton/react` is a `link:`ed checkout with a node_modules of its own, so React, React Aria
     * and the theme provider would resolve twice — two React copies break hooks, and two React Aria
     * copies break every context the design system reads (the router provider, the sidebar, the
     * command palette). Deduplicating pins all of them to this package's copies.
     */
    dedupe: ['react', 'react-dom', 'react-aria-components', 'next-themes', 'cn', 'lucide-react'],
  },

  plugins: [
    // Must run before tanstackStart/react so .mdx and `fumadocs-mdx/macro` calls are transformed first.
    fumadocsMdx({ index: false }),
    diagrams({ sourceDir: here('../../docs/diagrams') }),
    tailwindcss(),
    tanstackStart({
      pages: PAGES.map(path => ({ path })),
      prerender: {
        enabled: true,
        crawlLinks: true,
        concurrency: 4,
        retryCount: 3,
        retryDelay: 1000,
        /*
         * The crawler reads every `<a href>`, so a cross-link to a decision comes back as
         * `/docs/decisions#…`; it would be fetched and written again under the same output path.
         * A fragment is a place on a page, never a page.
         */
        filter: page =>
          !page.path.includes('#') && (page.path === '/' || /^\/(docs|api)(\/|$)/.test(page.path)),
      },
    }),
    viteReact(),
  ],
})
