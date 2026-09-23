/**
 * angular-eslint, loaded lazily so importing the `angular` preset's module never demands it.
 *
 * The repository's catalog carries ESLint 10.x; angular-eslint 19.x's own plugins peer on
 * `eslint ^8.57 || ^9`, while the individual `@angular-eslint/*` 22.x packages accept `^9 || ^10`
 * (verified against the published packages: `npm view @angular-eslint/eslint-plugin@22 peerDependencies`).
 * This preset uses the three individual packages — `eslint-plugin`, `eslint-plugin-template` and
 * `template-parser` — never the `angular-eslint` meta package, which peers on `@angular/cli` and
 * would pull in `@angular-devkit` for a lint-only dependency.
 *
 * The meta package is also the only one that ships a `configs.recommended`; the individual
 * `eslint-plugin`/`eslint-plugin-template` packages export rules only. `ANGULAR_TS_RECOMMENDED_RULES`
 * and `ANGULAR_TEMPLATE_RECOMMENDED_RULES` below are hand-copied from angular-eslint 22.5.0's own
 * `ts-recommended`/`template-recommended` configs, rather than spread from anything the meta package
 * ships, because that recommended set is reused across angular-eslint's own supported range and can
 * include a rule aimed at a later Angular than this adapter targets; every rule listed here is one
 * this preset has confirmed is valid for Angular 19 zoneless, standalone components.
 */

import type { ESLint, Linter } from 'eslint'
import { loadPeer, requirePeers } from './peer-require.ts'

const ANGULAR_ESLINT_PACKAGES: readonly string[] = [
  '@angular-eslint/eslint-plugin',
  '@angular-eslint/eslint-plugin-template',
  '@angular-eslint/template-parser',
]

const ANGULAR_ESLINT_INSTALL = `pnpm add -D ${ANGULAR_ESLINT_PACKAGES.join(' ')}`

export interface AngularPeers {
  readonly tsPlugin: ESLint.Plugin
  readonly templatePlugin: ESLint.Plugin
  readonly templateParser: Linter.Parser
}

let cached: AngularPeers | null = null

export function loadAngularPeers(): AngularPeers {
  if (cached !== null) return cached
  requirePeers(ANGULAR_ESLINT_PACKAGES, ANGULAR_ESLINT_INSTALL)
  cached = {
    tsPlugin: loadPeer<ESLint.Plugin>('@angular-eslint/eslint-plugin'),
    templatePlugin: loadPeer<ESLint.Plugin>('@angular-eslint/eslint-plugin-template'),
    templateParser: loadPeer<Linter.Parser>('@angular-eslint/template-parser'),
  }
  return cached
}

/**
 * Mirrors `@angular-eslint/eslint-plugin`'s own `ts-recommended` config (severities included), the
 * meta package's default for `.ts` files. `use-lifecycle-interface` is `warn` there too.
 */
export const ANGULAR_TS_RECOMMENDED_RULES: Readonly<Record<string, Linter.RuleEntry>> = {
  '@angular-eslint/contextual-lifecycle': 'error',
  '@angular-eslint/no-empty-lifecycle-method': 'error',
  '@angular-eslint/no-input-rename': 'error',
  '@angular-eslint/no-inputs-metadata-property': 'error',
  '@angular-eslint/no-output-native': 'error',
  '@angular-eslint/no-output-on-prefix': 'error',
  '@angular-eslint/no-output-rename': 'error',
  '@angular-eslint/no-outputs-metadata-property': 'error',
  '@angular-eslint/prefer-inject': 'error',
  '@angular-eslint/prefer-on-push-component-change-detection': 'error',
  '@angular-eslint/prefer-standalone': 'error',
  '@angular-eslint/use-pipe-transform-interface': 'error',
  '@angular-eslint/use-lifecycle-interface': 'warn',
}

/** Mirrors `@angular-eslint/eslint-plugin-template`'s own `template-recommended` config. */
export const ANGULAR_TEMPLATE_RECOMMENDED_RULES: Readonly<Record<string, Linter.RuleEntry>> = {
  '@angular-eslint/template/banana-in-box': 'error',
  '@angular-eslint/template/eqeqeq': 'error',
  '@angular-eslint/template/no-negated-async': 'error',
  '@angular-eslint/template/prefer-control-flow': 'error',
}
