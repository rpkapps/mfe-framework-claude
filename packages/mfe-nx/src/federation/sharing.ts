/**
 * What an Angular container shares, and what it never shares, in one place. The framework group
 * is kept apart from the page group so that it can move into a share scope of its own, keyed by
 * the Angular version, without touching the packages every framework on the page agrees on.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import {
  containerDependencies,
  createBuildError,
  installedVersionFrom,
  resolveShared,
  SINGLETON,
  type SharedModuleConfig,
  type SharingPolicies,
} from '@company/mfe-build/federation'

import { ANGULAR_ADAPTER } from '../adapter.ts'
import { SHARED_OPTION } from '../options.ts'

/**
 * Angular's injector tokens, platform and scheduler, the router, RxJS's subjects and the adapter
 * built on them are all module state: a second copy renders nothing the first provides, so every
 * Angular container on a page takes one copy, and a version mismatch fails loudly at load.
 */
export const ANGULAR_FRAMEWORK_POLICY: SharingPolicies = {
  '@angular/core': SINGLETON,
  '@angular/common': SINGLETON,
  // `packageOf` only strips a trailing slash, so `@angular/common/http` is shared through this
  // prefix entry; the bare entry alone never matches a subpath import.
  '@angular/common/': SINGLETON,
  '@angular/platform-browser': SINGLETON,
  '@angular/router': SINGLETON,
  '@angular/forms': SINGLETON,
  '@angular/animations': SINGLETON,
  '@angular/cdk': SINGLETON,
  '@angular/cdk/': SINGLETON,
  rxjs: SINGLETON,
  'rxjs/': SINGLETON,
  [ANGULAR_ADAPTER]: SINGLETON,
}

/**
 * The neutral packages keep page-wide state — the mount-token sequence, and the `instanceof`
 * checks errors and spans are recognised by — so they are the page's singletons whatever
 * framework a container renders with.
 */
export const PAGE_POLICY: SharingPolicies = {
  '@company/mfe-core': SINGLETON,
  '@company/mfe-runtime': SINGLETON,
}

export const ANGULAR_SHARING_POLICY: SharingPolicies = {
  ...ANGULAR_FRAMEWORK_POLICY,
  ...PAGE_POLICY,
}

/**
 * PrimeNG's theme engine keeps the page's style registry in module state, so a shared copy would
 * let one container's preset restyle every other container's components. Each container bundles
 * its own; the page stays consistent because every Angular container pins one PrimeNG version and
 * one preset.
 */
export const NEVER_SHARED: readonly string[] = [
  'primeng',
  '@primeng/themes',
  '@primeuix/styled',
  '@primeuix/utils',
]

/**
 * A container depends on the adapter alone, never on the neutral packages. A React shell provides
 * those, but it never provides the Angular adapter, so the first Angular container on a page
 * provides the adapter itself and the adapter's own imports resolve in that container's build.
 * Sharing the page singletons there, at the versions the adapter resolves, is what keeps them one
 * copy per page; without it the adapter would carry a second core into every Angular mount.
 */
export function adapterCarriedShares(
  containerRoot: string,
): Readonly<Record<string, SharedModuleConfig>> {
  const adapterRoot = installedPackageRoot(ANGULAR_ADAPTER, containerRoot)
  // Not installed: the container's own import of the adapter fails with the bundler's message.
  if (adapterRoot === undefined) return {}

  return resolveShared({
    policy: PAGE_POLICY,
    dependencies: containerDependencies(readAdapterManifest(adapterRoot)),
    installedVersion: installedVersionFrom(adapterRoot),
  })
}

/** An author may add shares, never one of the packages whose module state must stay private. */
export function assertShareable(
  overrides: Readonly<Record<string, string>>,
  containerRoot: string,
): void {
  for (const name of Object.keys(overrides)) {
    const owner = packageNameOf(name)
    if (!NEVER_SHARED.includes(owner)) continue

    throw createBuildError({
      file: join(containerRoot, 'package.json'),
      operation: 'resolve the Module Federation share scope',
      expected: `no ${owner} entry among the shared packages`,
      observed: `'${name}' added through ${SHARED_OPTION}`,
      declaredBy: 'The Angular sharing policy',
      repair: `Remove '${name}' from ${SHARED_OPTION}. Its theme engine keeps page-wide state, so each container bundles its own copy; keep every Angular container on the same PrimeNG version and preset instead.`,
    })
  }
}

/** The package a share belongs to: `primeng/button` is `primeng`, `@primeng/themes/aura` is `@primeng/themes`. */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/')
  return (specifier.startsWith('@') ? segments.slice(0, 2) : segments.slice(0, 1)).join('/')
}

/** Through the published manifest, so it resolves from the container the way its imports do. */
function installedPackageRoot(name: string, containerRoot: string): string | undefined {
  const require = createRequire(join(containerRoot, 'package.json'))
  try {
    return dirname(require.resolve(`${name}/package.json`))
  } catch {
    return undefined
  }
}

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

function readAdapterManifest(adapterRoot: string): PackageManifest {
  const file = join(adapterRoot, 'package.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageManifest
  } catch (cause) {
    throw createBuildError({
      file,
      operation: `read the dependencies of ${ANGULAR_ADAPTER}`,
      expected: 'a readable package manifest',
      observed: cause instanceof Error ? cause.message : 'an unreadable file',
      declaredBy: 'The Angular sharing policy',
      repair: `Reinstall ${ANGULAR_ADAPTER}. The page singletons it depends on are shared at the versions its manifest names.`,
      cause,
    })
  }
}
