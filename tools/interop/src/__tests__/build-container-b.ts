/**
 * Vitest global setup: bundles `fixtures/container-b.ts` against the second React in
 * `tools/interop-react-b`, as its own federation build would, and hands the bundle's path to the
 * tests through `inject('containerB')`.
 *
 * `react` and `react-dom` are aliased for every importer, React DOM's own import of React
 * included: React DOM throws minified error #527 unless the React it renders with is exactly its
 * own version, so a bundle holding 19.2's React DOM beside 19.3's React would fail at its first
 * render. `@company/mfe-core` and `@company/mfe-runtime` stay external and resolve to the files
 * the test's own copy of the adapter imports, so the bundle and the test share one of each, as a
 * page does through the `default` share scope.
 */

import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, type Plugin } from 'vite'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  interface ProvidedContext {
    /** The absolute path of the bundled `container-b.js`. */
    readonly containerB: string
  }
}

const interopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const secondReact = resolve(interopRoot, '../interop-react-b')
const outDir = join(interopRoot, 'dist/container-b')

/** A package's directory as `from` resolves it; each copy's manifest is exported. */
function packageDirectory(from: string, name: string): string {
  return dirname(createRequire(join(from, 'package.json')).resolve(`${name}/package.json`))
}

/** The page-wide packages, left as imports of exactly the files the test's adapter loads. */
function pageSingletonsExternal(): Plugin {
  const adapter = packageDirectory(interopRoot, '@company/mfe-react')

  return {
    name: 'page-singletons-external',
    enforce: 'pre',
    async resolveId(source) {
      if (!/^@company\/mfe-(core|runtime)(\/|$)/.test(source)) return null
      const resolved = await this.resolve(source, join(adapter, 'package.json'), {
        skipSelf: true,
      })
      if (resolved === null) {
        throw new Error(`${source} does not resolve from ${adapter}; run pnpm install.`)
      }
      return { id: resolved.id, external: true }
    },
  }
}

export default async function buildContainerB(project: TestProject): Promise<void> {
  const react = packageDirectory(secondReact, 'react')
  const reactDom = packageDirectory(secondReact, 'react-dom')

  await build({
    configFile: false,
    logLevel: 'warn',
    root: interopRoot,
    plugins: [pageSingletonsExternal()],
    resolve: {
      alias: [
        { find: /^react$/, replacement: join(react, 'index.js') },
        { find: /^react\/(.*)$/, replacement: `${react}/$1` },
        { find: /^react-dom$/, replacement: join(reactDom, 'index.js') },
        { find: /^react-dom\/(.*)$/, replacement: `${reactDom}/$1` },
      ],
    },
    // The same React build the test's own copy runs, so both report errors the same way.
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      rolldownOptions: {
        // TanStack Query marks its modules "use client", which means nothing outside a server
        // components build; the bundler would report every one of them.
        onLog(level, log, report) {
          if (log.code !== 'MODULE_LEVEL_DIRECTIVE') report(level, log)
        },
      },
      lib: {
        entry: join(interopRoot, 'src/fixtures/container-b.ts'),
        formats: ['es'],
        fileName: () => 'container-b.js',
      },
    },
  })

  project.provide('containerB', join(outDir, 'container-b.js'))
}
