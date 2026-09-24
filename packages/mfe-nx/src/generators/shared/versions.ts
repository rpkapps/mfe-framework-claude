/**
 * Every version this generator writes into a consumer's workspace, in one place, so a version
 * bump never means hunting through template files. These are the *generated project's* pins —
 * unrelated to this repository's own `catalog:` entries, which only cover what this package's own
 * tests run on (see the package README).
 */

import { NX_VERSION } from '@nx/devkit'

export const ANGULAR_VERSION = '19.2.25'
/**
 * The builder is versioned with the Angular CLI rather than the framework: 19.2.27 is the CLI
 * release published beside framework 19.2.25.
 */
export const ANGULAR_DEVKIT_VERSION = '19.2.27'
export const ANGULAR_CDK_VERSION = '^19.2.0'

/** Angular 19.2's compiler accepts TypeScript `>=5.5 <5.9`, so the two are pinned together. */
export const TYPESCRIPT_VERSION = '5.8.3'

export const RXJS_VERSION = '7.8.2'
/** The adapter and the container's contracts target the same Zod major. */
export const ZOD_VERSION = '4.6.5'

/**
 * One PrimeNG version per page: it writes its components' rules into page-wide style tags keyed by
 * name, so every Angular container on a page has to agree on it. No theme package: the container
 * gives PrimeNG no preset, and the host declares the design tokens its components read.
 */
export const PRIMENG_VERSION = '19.1.4'

/**
 * `@analogjs/vitest-angular` peers `vitest ^1.3.1 || ^2 || ^3 || ^4` — not 5 — so the generated
 * project's own Vitest is pinned a major behind this repository's.
 */
export const VITEST_VERSION = '^4.0.0'
export const VITE_VERSION = '^7.0.0'
export const JSDOM_VERSION = '^26.0.0'
export const ANALOG_VITE_PLUGIN_ANGULAR_VERSION = '^2.7.0'
export const ANALOG_VITEST_ANGULAR_VERSION = '^2.7.0'

/**
 * The framework packages this generator wires the container to. `^0.1.0` because that is their
 * current published version; a consumer workspace resolves the real range through its own
 * registry the way it resolves every other dependency.
 */
export const FRAMEWORK_PACKAGE_VERSION = '^0.1.0'

/**
 * `@company/eslint-plugin-mfe`'s own peer range for these is `>=19 <23`; this pins the exact line
 * the plugin's tests and this repository's catalog verify against.
 */
export const ANGULAR_ESLINT_VERSION = '22.5.0'
/** Matches this repository's own `catalog:` pin, which `@angular-eslint/*` above accepts (`^9 || ^10`). */
export const ESLINT_VERSION = '10.10.0'
/**
 * ESLint reads a TypeScript config — and `@company/eslint-plugin-mfe`'s TypeScript sources behind
 * it — only through jiti, which it declares as an optional peer and never installs itself. Matches
 * this repository's own `catalog:` pin; ESLint 10 needs 2.2 or later.
 */
export const JITI_VERSION = '2.7.0'

/**
 * The Nx majors whose `@nx/angular` still builds Angular 19.2: 20.x peers the Angular builder
 * `>=17 <20`, 21.x `>=18 <21`, 22.x `>=19 <22`, and 23.x requires Angular 20.
 */
export const SUPPORTED_NX_MAJORS: readonly number[] = [20, 21, 22]

/**
 * `@nx/angular` has to be the workspace's own Nx version, as every Nx plugin does, so it is
 * written with the same specifier as `nx`. A specifier that names no version, such as pnpm's
 * `catalog:`, is read as the Nx running this generator, which is what it resolved to. A workspace
 * on an Nx line that cannot build Angular 19.2 is refused before anything is written.
 */
export function nxAngularVersionFor(nxVersion: string | undefined): string {
  const version = nxVersion !== undefined && /^[\^~]?\d/.test(nxVersion) ? nxVersion : NX_VERSION
  const major = Number(/^[\^~]?(\d+)\./.exec(version)?.[1])
  if (SUPPORTED_NX_MAJORS.includes(major)) return version

  throw new Error(
    `@company/mfe-nx cannot scaffold an Angular 19.2 container in this workspace: it needs Nx ` +
      `${SUPPORTED_NX_MAJORS.join(', ')} (the lines whose @nx/angular builds Angular 19), and the ` +
      `workspace uses nx ${version}. @nx/angular has to match the workspace's Nx version, and ` +
      '@nx/angular 23 and later require Angular 20. Run the generator in an Nx 22 workspace, ' +
      'for example one created with create-nx-workspace@22.',
  )
}

/** Only an exact or patch-level 5.5–5.8 stays within the Angular 19.2 compiler's range. */
export function isAngularCompatibleTypeScript(specifier: string): boolean {
  return /^~?5\.[5-8]\.\d+$/.test(specifier)
}
