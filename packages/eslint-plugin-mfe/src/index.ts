/**
 * The shared lint contract for this monorepo and for the repositories that ship
 * MFEs against it: two composable flat-config presets and four MFE-specific
 * rules. The presets are plain arrays, so an `eslint.config.mjs` spreads
 * `mfe.configs.framework` or calls `mfe.author({...})` to declare scopes. This
 * package is development-only and never part of the runtime import DAG.
 */

import type { Linter } from 'eslint'
import { rules } from './rules/index.ts'
import { author, type AuthorPresetOptions } from './configs/author.ts'
import { framework, type FrameworkPresetOptions } from './configs/framework.ts'

export { rules }
export { author, framework }
export type { AuthorPresetOptions, FrameworkPresetOptions }
export type { RestrictedPath, RestrictedPattern } from './configs/restricted-imports.ts'

export const meta = { name: '@company/eslint-plugin-mfe', version: '0.1.0' } as const

/** The presets called with their defaults, so spreading the array and calling
 * the factory produce the same configuration. */
export const configs: {
  readonly framework: Linter.Config[]
  readonly author: Linter.Config[]
} = {
  framework: framework(),
  author: author(),
}

const plugin = { meta, rules, configs, framework, author }

export default plugin
