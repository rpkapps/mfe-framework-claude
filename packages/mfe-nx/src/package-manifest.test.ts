/**
 * This package has only compiled output, not the source the others also name: Nx loads a plugin's
 * generators and executors with `require`, from the paths its manifests name, and every one of
 * them is under `dist/`, which is build output and never checked in. So a pack has to refuse a
 * `dist/` that is missing or older than the source — otherwise it ships whatever a working tree
 * happens to hold — and every path the manifests name has to be one the build emits.
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const packageRoot = join(__dirname, '..')
const requireBuilt = join(packageRoot, '../../tools/workspace/require-built.mjs')

function readManifest<T>(name: string): T {
  return JSON.parse(readFileSync(join(packageRoot, name), 'utf8')) as T
}

interface PackageManifest {
  readonly main: string
  readonly exports: Readonly<Record<string, string | Readonly<Record<string, string>>>>
  readonly files: readonly string[]
  readonly scripts: Readonly<Record<string, string>>
}

/** Every path a consumer's Nx or Node loads, as the manifests spell it. */
function publishedPaths(): string[] {
  const pkg = readManifest<PackageManifest>('package.json')
  const generators = readManifest<{
    generators: Record<string, { factory: string; schema: string }>
  }>('generators.json')
  const executors = readManifest<{
    executors: Record<string, { implementation: string; schema: string }>
  }>('executors.json')

  const exportTargets = Object.entries(pkg.exports)
    .filter(([subpath]) => subpath !== './package.json')
    .flatMap(([, target]) => (typeof target === 'string' ? [target] : Object.values(target)))

  return [
    pkg.main,
    ...exportTargets,
    ...Object.values(generators.generators).flatMap(({ factory, schema }) => [
      factory.replace(/#.*$/, ''),
      schema,
    ]),
    ...Object.values(executors.executors).flatMap(({ implementation, schema }) => [
      implementation,
      schema,
    ]),
  ]
}

/** The source the build emits a `dist/` path from: `tsc` for modules, the copy script for JSON. */
function sourceOf(published: string): string {
  const inSrc = published.replace(/^\.\/dist\//, '')
  if (inSrc.endsWith('.json')) return inSrc
  return inSrc.replace(/\.d\.ts$|\.js$|$/, '.ts')
}

describe('the published manifest', () => {
  it('checks its build before it is packed, so a pack never ships a stale or missing dist', () => {
    const pkg = readManifest<PackageManifest>('package.json')

    expect(pkg.files).toContain('dist')
    expect(pkg.scripts['prepack']).toBe('node ../../tools/workspace/require-built.mjs')
    expect(pkg.scripts['build']).toContain('tsc -p tsconfig.build.json')
  })

  it('names only paths the build emits, from sources that exist', () => {
    const paths = publishedPaths()

    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect(path, path).toMatch(/^\.\/dist\/src\//)
      expect(existsSync(join(packageRoot, sourceOf(path))), `${path} ← ${sourceOf(path)}`).toBe(
        true,
      )
    }
  })
})

describe('the prepack check', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  /** A package whose source was last changed at `sourceTime` and built at `builtTime`, if ever. */
  function prepack(sourceTime: number, builtTime: number | null): number | null {
    const root = mkdtempSync(join(tmpdir(), 'mfe-prepack-'))
    roots.push(root)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@company/fixture',
        exports: {
          '.': {
            'mfe-source': './src/index.ts',
            types: './dist/index.d.ts',
            default: './dist/index.js',
          },
        },
      }),
    )
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/index.ts'), 'export {}\n')
    utimesSync(join(root, 'src/index.ts'), sourceTime, sourceTime)
    if (builtTime !== null) {
      mkdirSync(join(root, 'dist'))
      for (const file of ['index.js', 'index.d.ts']) {
        writeFileSync(join(root, 'dist', file), 'export {}\n')
        utimesSync(join(root, 'dist', file), builtTime, builtTime)
      }
    }
    return spawnSync(process.execPath, [requireBuilt], { cwd: root, encoding: 'utf8' }).status
  }

  it('packs a build newer than its source', () => {
    expect(prepack(1_000, 2_000)).toBe(0)
  })

  it('refuses a missing build, and one the source changed after', () => {
    expect(prepack(1_000, null)).toBe(1)
    expect(prepack(2_000, 1_000)).toBe(1)
  })
})
