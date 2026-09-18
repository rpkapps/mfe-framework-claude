/**
 * `@company/eslint-plugin-mfe` — the shared lint contract for this monorepo and
 * for the repositories that ship MFEs against it.
 *
 * Two composable flat-config presets and four MFE-specific rules. The presets
 * are plain arrays, so an `eslint.config.mjs` spreads them:
 *
 * ```js
 * import mfe from '@company/eslint-plugin-mfe'
 *
 * export default [...mfe.configs.framework]
 * ```
 *
 * and calls the factory of the same name when it needs to declare scopes:
 *
 * ```js
 * export default [
 *   ...mfe.author({
 *     tsconfigRootDir: import.meta.dirname,
 *     widgetScopes: ['src/widgets/**'],
 *   }),
 * ]
 * ```
 *
 * This package is development-only: it is never part of the runtime import DAG.
 */

import type { Linter } from 'eslint'
import { rules } from './rules/index.ts'
import { author, DEFAULT_ROUTER_FILES, type AuthorPresetOptions } from './configs/author.ts'
import { framework, type FrameworkPresetOptions } from './configs/framework.ts'

export { rules }
export { author, framework, DEFAULT_ROUTER_FILES }
export type { AuthorPresetOptions, FrameworkPresetOptions }
export type { RestrictedPath, RestrictedPattern } from './configs/restricted-imports.ts'

export const meta = { name: '@company/eslint-plugin-mfe', version: '0.1.0' } as const

/**
 * Ready-made presets. `configs.framework` and `configs.author` are the factories
 * called with their defaults, so both spellings — spread the array, or call the
 * factory with options — produce the same configuration.
 */
export const configs: {
  readonly framework: Linter.Config[]
  readonly author: Linter.Config[]
} = {
  framework: framework(),
  author: author(),
}

const plugin = { meta, rules, configs, framework, author }

export default plugin
