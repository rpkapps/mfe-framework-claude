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

interface PackageManifest {
  readonly version?: unknown
}

export function installedVersionFrom(root: string): (name: string) => string | undefined {
  return name => {
    const packageRoot = installedPackageRoot(name, root)
    if (packageRoot === undefined) return undefined
    const version = readManifest(join(packageRoot, 'package.json'))?.version
    return typeof version === 'string' ? version : undefined
  }
}

/**
 * The directory a bare import of `name` from `root` lands in, with symbolic links resolved, so a
 * package's own dependencies are then found beside it the way pnpm links them.
 */
export function installedPackageRoot(name: string, root: string): string | undefined {
  let directory = root
  for (;;) {
    const candidate = join(directory, 'node_modules', name)
    if (readManifest(join(candidate, 'package.json')) !== undefined) return realpathSync(candidate)

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
