/**
 * What a dependency range actually resolved to, read from one package's own
 * `node_modules` rather than from this one. A `catalog:` or `workspace:` range
 * names no version at all, and even an ordinary range is not what a build
 * provides — the install is. Both the container plan and a host's share scope
 * advertise the resolved version, so both read it through here.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

interface PackageManifest {
  readonly name?: unknown
  readonly version?: unknown
}

/**
 * Three places to look, in order, because no single one covers every package:
 * the manifest an `exports` map publishes (sonner's does not), the manifest
 * beside the resolved entry (a package with no root entry has none), and pnpm's
 * link in this root's `node_modules` (only for a direct dependency, which
 * `@company/mfe-core` is not).
 *
 * Nothing here throws. A candidate that resolves nowhere is one this root
 * cannot provide, and the caller decides what that means.
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
    // Either not installed, or installed behind an `exports` map that does not
    // publish the manifest. Both refusals look the same from here.
    return undefined
  }
}

/**
 * The manifest of the package an entry resolves into. The walk stops at the
 * first manifest that names the package asked about, so a nested `package.json`
 * marking a directory's module type is skipped rather than mistaken for it.
 */
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
