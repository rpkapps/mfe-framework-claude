/**
 * What a dependency range actually resolved to; a `catalog:` range names no version at all.
 *
 * Read by walking the `node_modules` directories above a root, the way a bundler resolves a bare
 * import, and never through `require`: Node's `require` also searches `NODE_PATH`, which pnpm's
 * binary shims point at the whole store, so a package the root never depends on would resolve
 * whenever the build happened to be launched through one. What is shared must not depend on how
 * the command was started.
 */

import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Only what the build reads from an installed package's manifest. */
export interface InstalledManifest {
  readonly version?: unknown
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

export interface InstalledPackage {
  /** Symbolic links resolved, so the package's own dependencies are found beside it. */
  readonly directory: string
  readonly manifest: InstalledManifest
}

/**
 * Each name is looked up once per function: a prefix share asks again for the package it names,
 * and the framework anchor is also a candidate, so a plan would otherwise read one manifest
 * several times.
 */
export function installedVersionFrom(root: string): (name: string) => string | undefined {
  const versions = new Map<string, string | undefined>()

  return name => {
    if (versions.has(name)) return versions.get(name)
    const version = installedPackage(name, root)?.manifest.version
    const installed = typeof version === 'string' ? version : undefined
    versions.set(name, installed)
    return installed
  }
}

/**
 * The package a bare import of `name` from `root` lands in, the way pnpm links it, with the
 * manifest that showed it is there.
 */
export function installedPackage(name: string, root: string): InstalledPackage | undefined {
  let directory = root
  for (;;) {
    const candidate = join(directory, 'node_modules', name)
    const manifest = readManifest(join(candidate, 'package.json'))
    if (manifest !== undefined) return { directory: realpathSync(candidate), manifest }

    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

function readManifest(file: string): InstalledManifest | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as InstalledManifest
  } catch {
    return undefined
  }
}
