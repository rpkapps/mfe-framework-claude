/** Reads the consumer workspace's own installed Nx major, tolerating the `^`/`~` a package.json
 * range usually carries. */

import { readJson, type Tree } from '@nx/devkit'

const DEFAULT_NX_MAJOR = 22

interface RootPackageJson {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

export function readNxMajor(tree: Tree): number {
  const root = readJson<RootPackageJson>(tree, 'package.json')
  const raw = root.dependencies?.['nx'] ?? root.devDependencies?.['nx']
  if (raw === undefined) return DEFAULT_NX_MAJOR

  const match = /^[\^~]?(\d+)\./.exec(raw)
  return match?.[1] === undefined ? DEFAULT_NX_MAJOR : Number(match[1])
}
