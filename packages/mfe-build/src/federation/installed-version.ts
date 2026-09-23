/** What a dependency range actually resolved to; a `catalog:` range names no version at all. */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

interface PackageManifest {
  readonly name?: unknown
  readonly version?: unknown
}

/**
 * Three lookups, because an `exports` map need not publish the manifest, a package with no root
 * entry has none beside it, and pnpm links only a direct dependency into this root.
 */
export function installedVersionFrom(root: string): (name: string) => string | undefined {
  const require = createRequire(join(root, 'package.json'))

  return name =>
    versionOf(published(require, name)) ??
    versionOf(besideTheEntry(require, name)) ??
    versionOf(readManifest(join(root, 'node_modules', name, 'package.json')))
}

function versionOf(manifest: PackageManifest | undefined): string | undefined {
  return typeof manifest?.version === 'string' ? manifest.version : undefined
}

function published(require: NodeJS.Require, name: string): PackageManifest | undefined {
  try {
    return require(`${name}/package.json`) as PackageManifest
  } catch {
    // Either not installed, or installed behind an `exports` map that hides the manifest.
    return undefined
  }
}

/** The walk stops at the first manifest naming the package, so a nested one is not mistaken. */
function besideTheEntry(require: NodeJS.Require, name: string): PackageManifest | undefined {
  let directory: string
  try {
    directory = dirname(require.resolve(name))
  } catch {
    return undefined
  }

  for (;;) {
    const manifest = readManifest(join(directory, 'package.json'))
    if (manifest?.name === name) return manifest

    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

function readManifest(file: string): PackageManifest | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageManifest
  } catch {
    return undefined
  }
}
