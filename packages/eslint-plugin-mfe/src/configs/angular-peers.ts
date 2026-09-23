/**
 * angular-eslint, loaded lazily so importing the `angular` preset's module never demands it. This
 * preset depends on the three individual `@angular-eslint/*` packages, never the `angular-eslint`
 * meta package, which peers on `@angular/cli` and would pull in `@angular-devkit` for a lint-only
 * dependency — and only the meta package ships `configs.recommended`, so the two rule records below
 * are hand-copied from it, each confirmed valid for Angular 19 zoneless, standalone components.
 */

import type { ESLint, Linter } from 'eslint'
import { lazyPeers, loadPeer } from './peer-require.ts'

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

export const loadAngularPeers = lazyPeers<AngularPeers>(
  ANGULAR_ESLINT_PACKAGES,
  ANGULAR_ESLINT_INSTALL,
  () => ({
    tsPlugin: loadPeer<ESLint.Plugin>('@angular-eslint/eslint-plugin'),
    templatePlugin: loadPeer<ESLint.Plugin>('@angular-eslint/eslint-plugin-template'),
    templateParser: loadPeer<Linter.Parser>('@angular-eslint/template-parser'),
  }),
)

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
