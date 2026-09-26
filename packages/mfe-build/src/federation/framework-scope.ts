/**
 * Where a container's or a host's shares come from beyond its own manifest: the framework scope,
 * named after the version its framework's anchor package resolved to, and the page-wide packages
 * an adapter carries in as its own dependencies.
 */

import { join } from 'node:path'

import { createBuildError } from '../diagnostics.ts'
import { installedPackage, installedVersionFrom } from './installed-version.ts'
import {
  containerDependencies,
  frameworkShareScope,
  PAGE_SHARE_SCOPE,
  resolveShared,
  type SharedModuleConfig,
  type SharingPolicies,
} from './sharing.ts'

export interface FrameworkScopeOptions {
  /** The framework's name, which the scope starts with: `react`. */
  readonly framework: string
  /** The package whose installed version names the scope: `react`, `@angular/core`. */
  readonly anchor: string
  /** The directory holding the package.json the anchor is resolved from. */
  readonly root: string
  /** Injected so the rule can be exercised without an install; defaults to reading `root`. */
  readonly installedVersion?: (name: string) => string | undefined
}

/**
 * The version is the one installed rather than any declared range, because the scope is only as
 * useful as it is exact: two containers in one scope share one copy strictly.
 */
export function resolveFrameworkScope(options: FrameworkScopeOptions): string {
  const installedVersion = options.installedVersion ?? installedVersionFrom(options.root)
  const version = installedVersion(options.anchor)
  if (version !== undefined) return frameworkShareScope(options.framework, version)

  throw createBuildError({
    file: join(options.root, 'package.json'),
    operation: `name the ${options.framework} share scope`,
    expected: `${options.anchor} installed, whose exact version names the scope`,
    observed: `no ${options.anchor} resolvable from ${options.root}`,
    declaredBy: 'The build integration',
    repair: `Add ${options.anchor} to the dependencies in ${join(options.root, 'package.json')} and install them.`,
  })
}

/** The page-wide half of a policy: the candidates an adapter carries in for every framework. */
export function pagePolicy(policy: SharingPolicies): SharingPolicies {
  return Object.fromEntries(Object.entries(policy).filter(([, entry]) => !entry.frameworkScoped))
}

export interface AdapterDependencies {
  /** The adapter's own `dependencies` and `peerDependencies`, merged. */
  readonly dependencies: Readonly<Record<string, string>>
  /**
   * Versions as the adapter resolves them, which is where its own imports land, for the names it
   * declares; anything else beside it is not what the adapter imports.
   */
  readonly installedVersion: (name: string) => string | undefined
}

/**
 * Where a container's or a host's page-wide packages are read, since neither depends on them itself:
 * beside the adapter, at the versions it declares. `undefined` when the adapter is not installed:
 * the container's own import of it then fails with the bundler's message, which names the import.
 */
export function adapterDependencies(
  adapter: string,
  root: string,
): AdapterDependencies | undefined {
  const installed = installedPackage(adapter, root)
  if (installed === undefined) return undefined

  const dependencies = containerDependencies(installed.manifest)
  const beside = installedVersionFrom(installed.directory)
  return {
    dependencies,
    installedVersion: name => (Object.hasOwn(dependencies, name) ? beside(name) : undefined),
  }
}

/**
 * A container depends on its adapter alone, never on the neutral packages, so the adapter's own
 * imports of them resolve beside the adapter. Sharing them there, at the versions the adapter
 * declares, is what keeps them one copy per page; without it every container would carry a
 * second core into its mounts.
 */
export function adapterCarriedShares(options: {
  readonly adapter: string
  readonly containerRoot: string
  readonly policy: SharingPolicies
}): Readonly<Record<string, SharedModuleConfig>> {
  const carried = adapterDependencies(options.adapter, options.containerRoot)
  if (carried === undefined) return {}

  return resolveShared({
    policy: pagePolicy(options.policy),
    dependencies: carried.dependencies,
    installedVersion: carried.installedVersion,
    // Only page-wide candidates are carried, so none of them goes in a framework scope.
    frameworkScope: PAGE_SHARE_SCOPE,
  })
}
