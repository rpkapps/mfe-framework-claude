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
 *
 * A full bundle of a second React DOM takes seconds, and only one suite reads it, so a build is
 * skipped when nothing it read has changed since the last one: every file is recorded with a
 * digest of its contents beside the bundle.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, type Plugin } from 'vite'
import type { TestProject } from 'vitest/node'

import { sourceResolveForTests } from '../../../workspace/conditions.mjs'

declare module 'vitest' {
  interface ProvidedContext {
    /** The absolute path of the bundled `container-b.js`. */
    readonly containerB: string
  }
}

const thisFile = fileURLToPath(import.meta.url)
const interopRoot = resolve(dirname(thisFile), '../..')
const workspaceRoot = resolve(interopRoot, '../..')
const secondReact = resolve(interopRoot, '../interop-react-b')
const outDir = join(interopRoot, 'dist/container-b')
const bundle = join(outDir, 'container-b.js')
const buildRecord = join(outDir, 'build-record.json')

type Digests = Readonly<Record<string, string | null>>

/** What the last build wrote, and every file it read with the digest of its contents then. */
interface BuildRecord {
  readonly outputs: readonly string[]
  readonly inputs: Digests
}

/** A package's directory as `from` resolves it; each copy's manifest is exported. */
function packageDirectory(from: string, name: string): string {
  return dirname(createRequire(join(from, 'package.json')).resolve(`${name}/package.json`))
}

/** The page-wide packages, left as imports of exactly the files the test's adapter loads. */
function pageSingletonsExternal(externals: Set<string>): Plugin {
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
      externals.add(resolved.id)
      return { id: resolved.id, external: true }
    },
  }
}

/** The nearest manifest above `file`, which decides how the package it sits in resolves. */
function manifestOf(file: string): string | null {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) return manifest
    if (dirname(directory) === directory) return null
  }
}

/**
 * What a build depends on: the modules it read, bundled or left external, the manifest of each
 * package they sit in, the lockfile that pinned those packages, and this file, which configures it.
 */
function inputsOf(modules: Iterable<string>): string[] {
  const files = new Set([thisFile, join(workspaceRoot, 'pnpm-lock.yaml')])
  for (const id of modules) {
    // Rolldown's own helpers have virtual ids, and a query only selects a view of a file.
    const file = id.split('?')[0] ?? id
    if (!isAbsolute(file)) continue
    files.add(file)
    const manifest = manifestOf(file)
    if (manifest !== null) files.add(manifest)
  }
  return [...files].sort()
}

async function digestsOf(files: Iterable<string>): Promise<Digests> {
  const entries = await Promise.all(
    [...files].map(async file => {
      try {
        return [
          file,
          createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        ] as const
      } catch {
        return [file, null] as const
      }
    }),
  )
  return Object.fromEntries(entries)
}

async function isUpToDate(): Promise<boolean> {
  let record: BuildRecord
  try {
    record = JSON.parse(await readFile(buildRecord, 'utf8')) as BuildRecord
  } catch {
    return false
  }
  if (!record.outputs.every(file => existsSync(join(outDir, file)))) return false
  const current = await digestsOf(Object.keys(record.inputs))
  return Object.entries(record.inputs).every(
    ([file, digest]) => digest !== null && current[file] === digest,
  )
}

async function buildContainer(): Promise<void> {
  const react = packageDirectory(secondReact, 'react')
  const reactDom = packageDirectory(secondReact, 'react-dom')
  const externals = new Set<string>()

  const output = await build({
    configFile: false,
    logLevel: 'warn',
    root: interopRoot,
    plugins: [pageSingletonsExternal(externals)],
    resolve: {
      // The framework packages as the test's own copy of the adapter resolves them.
      conditions: sourceResolveForTests.conditions,
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

  // A library build reports one output per format, and never a watcher without `build.watch`.
  const written = (Array.isArray(output) ? output : [output]).flatMap(result =>
    'output' in result ? result.output : [],
  )
  const bundled = written.flatMap(file => (file.type === 'chunk' ? file.moduleIds : []))
  const record: BuildRecord = {
    outputs: written.map(file => file.fileName),
    inputs: await digestsOf(inputsOf([...bundled, ...externals])),
  }
  await writeFile(buildRecord, `${JSON.stringify(record, null, 2)}\n`)
}

export default async function provideContainerB(project: TestProject): Promise<void> {
  if (!(await isUpToDate())) await buildContainer()
  project.provide('containerB', bundle)
}
