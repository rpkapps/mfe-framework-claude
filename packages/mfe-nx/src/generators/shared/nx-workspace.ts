/** What the consumer workspace's own root manifest already says about its toolchain. */

import { logger, readJson, updateJson, type Tree } from '@nx/devkit'

import { isAngularCompatibleTypeScript, TYPESCRIPT_VERSION } from './versions.ts'

interface RootPackageJson {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

/** The workspace's declared `nx` specifier, or `undefined` when its manifest does not list one. */
export function readNxVersion(tree: Tree): string | undefined {
  const root = readJson<RootPackageJson>(tree, 'package.json')
  return root.devDependencies?.['nx'] ?? root.dependencies?.['nx']
}

/**
 * `addDependenciesToPackageJson` never lowers a version, and a workspace on TypeScript 5.9 or
 * later cannot compile an Angular 19.2 container at all, so the workspace's own TypeScript is
 * pinned to the Angular line here, and the change is logged rather than made silently.
 */
export function pinWorkspaceTypeScript(tree: Tree): void {
  const root = readJson<RootPackageJson>(tree, 'package.json')
  const field =
    root.devDependencies?.['typescript'] === undefined ? 'dependencies' : 'devDependencies'
  const current = root[field]?.['typescript']
  if (current === undefined || isAngularCompatibleTypeScript(current)) return

  logger.warn(
    `@company/mfe-nx: pinned the workspace's typescript from ${current} to ${TYPESCRIPT_VERSION}. ` +
      'Angular 19.2 compiles only with TypeScript >=5.5 <5.9, and an Nx workspace has one ' +
      'TypeScript for every project in it.',
  )
  updateJson<RootPackageJson, RootPackageJson>(tree, 'package.json', json => ({
    ...json,
    [field]: { ...json[field], typescript: TYPESCRIPT_VERSION },
  }))
}
