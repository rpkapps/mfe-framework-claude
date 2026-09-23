/**
 * What an Angular container shares, and what it never shares, in one place. The framework group
 * goes in a share scope of its own, keyed by the exact `@angular/core` version, apart from the
 * packages every framework on the page agrees on, which the build adds and keeps in `default`.
 */

import { join } from 'node:path'

import { createBuildError, SINGLETON, type SharingPolicies } from '@company/mfe-build/federation'

import { ANGULAR_ADAPTER } from '../adapter.ts'
import { SHARED_OPTION } from '../options.ts'

/** The name Angular's share scope starts with, and what a registry entry's `framework` says. */
export const ANGULAR_FRAMEWORK = 'angular'

/** The package whose installed version names the scope: `angular@19.2.25`. */
export const ANGULAR_ANCHOR = '@angular/core'

/**
 * Angular's injector tokens, platform and scheduler, the router, RxJS's subjects and the adapter
 * built on them are all module state: a second copy renders nothing the first provides, so every
 * Angular container on the same Angular version takes one copy, and a version mismatch inside
 * that scope fails loudly at load. A container on another Angular version brings its own set.
 */
export const ANGULAR_SHARING_POLICY: SharingPolicies = {
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
