/**
 * Every version this generator writes into a consumer's workspace, in one place, so a version
 * bump never means hunting through template files. These are the *generated project's* pins —
 * unrelated to this repository's own `catalog:` entries, which only cover `@nx/devkit` and `nx`
 * for this package's own tests (see the package README).
 */

import { logger } from '@nx/devkit'

// Angular 19's compiler rejects TypeScript 5.9+, so both are pinned together and never
// independently bumped without re-verifying the pair.
export const ANGULAR_VERSION = '19.2.25'
export const TYPESCRIPT_VERSION = '5.8.3'

export const RXJS_VERSION = '7.8.2'
// Matches this repository's own `zod` catalog pin, since the adapter and the generated
// container's contracts both target the same major.
export const ZOD_VERSION = '4.6.5'

export const RSPACK_VERSION = '^1.6.0'
export const MODULE_FEDERATION_ENHANCED_VERSION = '^2.9.0'
export const TAILWIND_VERSION = '^4.3.3'

// `@analogjs/vitest-angular` peers `vitest ^1.3.1 || ^2 || ^3 || ^4` — not 5 — so the generated
// project's own Vitest is pinned a major behind this repository's.
export const VITEST_VERSION = '^4.0.0'
export const VITE_VERSION = '^7.0.0'
export const JSDOM_VERSION = '^26.0.0'
export const ANALOG_VITE_PLUGIN_ANGULAR_VERSION = '^2.7.0'
export const ANALOG_VITEST_ANGULAR_VERSION = '^2.7.0'

// The framework packages this generator wires the container to. `^0.1.0` because that is their
// current published version; a consumer workspace resolves the real range through its own
// registry the way it resolves every other dependency.
export const FRAMEWORK_PACKAGE_VERSION = '^0.1.0'

const DEFAULT_NX_MAJOR = 22

const ANGULAR_RSPACK_VERSION_BY_NX_MAJOR: Readonly<Record<number, string>> = {
  20: '20.9.0',
  21: '21.6.5',
  [DEFAULT_NX_MAJOR]: '22.7.12',
}

/**
 * `@nx/angular-rspack` ships a line per Nx major that still supports Angular 19 (20.6–20.9,
 * 21.x, 22.x; 23.x requires Angular 20+). A workspace on a major this generator has not verified
 * gets the newest verified line rather than a guess, and a logged reason so the choice is never
 * silent.
 */
export function angularRspackVersionFor(nxMajor: number): string {
  const known = ANGULAR_RSPACK_VERSION_BY_NX_MAJOR[nxMajor]
  if (known !== undefined) return known

  logger.warn(
    `@company/nx-mfe: no @nx/angular-rspack line has been verified against Nx ${nxMajor}; using ` +
      `the Nx ${DEFAULT_NX_MAJOR} line (${ANGULAR_RSPACK_VERSION_BY_NX_MAJOR[DEFAULT_NX_MAJOR]}). ` +
      'If this workspace needs a different line, pin @nx/angular-rspack yourself after generation.',
  )
  return ANGULAR_RSPACK_VERSION_BY_NX_MAJOR[DEFAULT_NX_MAJOR] as string
}
