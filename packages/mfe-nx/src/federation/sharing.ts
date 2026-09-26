/**
 * What an Angular container shares, and what it never shares, in one place. The framework group
 * goes in a share scope of its own, keyed by the exact `@angular/core` version, apart from the
 * packages every framework on the page agrees on, which the build adds and keeps in `default`.
 */

import { join } from 'node:path'

import {
  createBuildError,
  FRAMEWORK_SCOPED,
  packageOf,
  type SharingPolicies,
} from '@company/mfe-build/federation'

import { SHARED_OPTION } from '../options.ts'

/** The name Angular's share scope starts with, and what a registry entry's `framework` says. */
export const ANGULAR_FRAMEWORK = 'angular'

/** The package whose installed version names the scope: `angular@19.2.25`. */
export const ANGULAR_ANCHOR = '@angular/core'

/**
 * Angular's injector tokens, platform and scheduler, the router, RxJS's subjects and the adapter
 * built on them are all module state, so they are shared only with containers on the same Angular
 * version, and a container on another version brings its own set. None is a singleton (§55): in
 * `angular@19.2.25` every container provides that `@angular/core`, so the core is one copy anyway,
 * and the rest resolve to the loaded copy a container's range accepts, or to its own. Each
 * container bootstraps an application of its own, so no token crosses from one to another.
 *
 * The adapter itself is not shared: it compares the router's classes and tokens and provides the
 * HTTP interceptor, and a shared adapter would compare them against the copies the build that
 * provided it resolved. Bundled, it imports them through the container's own shares, as the
 * author's code does.
 */
export const ANGULAR_SHARING_POLICY: SharingPolicies = {
  '@angular/core': FRAMEWORK_SCOPED,
  '@angular/common': FRAMEWORK_SCOPED,
  // A bare share key never matches a subpath import, so `@angular/common/http` is shared through
  // this prefix entry.
  '@angular/common/': FRAMEWORK_SCOPED,
  '@angular/platform-browser': FRAMEWORK_SCOPED,
  '@angular/router': FRAMEWORK_SCOPED,
  '@angular/forms': FRAMEWORK_SCOPED,
  '@angular/animations': FRAMEWORK_SCOPED,
  '@angular/cdk': FRAMEWORK_SCOPED,
  '@angular/cdk/': FRAMEWORK_SCOPED,
  rxjs: FRAMEWORK_SCOPED,
  'rxjs/': FRAMEWORK_SCOPED,
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
    const owner = packageOf(name)
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
