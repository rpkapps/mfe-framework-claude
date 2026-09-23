/**
 * Unlike the other framework packages, this one publishes compiled output: Nx loads a plugin's
 * generators and executors with `require`, from the paths its manifests name, and every one of
 * them is under `dist/`, which is build output and never checked in. So a pack has to build
 * first — otherwise it ships whatever `dist/` a working tree happens to hold, stale or missing —
 * and every path the manifests name has to be one the build emits.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const packageRoot = join(__dirname, '..')

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
  it('builds before it is packed, so a pack never ships a stale or missing dist', () => {
    const pkg = readManifest<PackageManifest>('package.json')

    expect(pkg.files).toContain('dist')
    expect(pkg.scripts['prepack']).toBe('pnpm run build')
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
