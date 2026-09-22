/**
 * Three composable flat-config presets and four MFE rules; the package is development-only and
 * never part of the runtime import DAG.
 */

import type { Linter } from 'eslint'
import { rules } from './rules/index.ts'
import { author, DEFAULT_ROUTER_FILES, type AuthorPresetOptions } from './configs/author.ts'
import { framework, type FrameworkPresetOptions } from './configs/framework.ts'
import { tooling, DEFAULT_TOOLING_FILES, type ToolingPresetOptions } from './configs/tooling.ts'

export { rules }
export { author, framework, tooling }
export { DEFAULT_ROUTER_FILES, DEFAULT_TOOLING_FILES }
export type { AuthorPresetOptions, FrameworkPresetOptions, ToolingPresetOptions }
export type { RestrictedPath, RestrictedPattern } from './configs/restricted-imports.ts'

export const meta = { name: '@company/eslint-plugin-mfe', version: '0.1.0' } as const

/** The presets called with their defaults, so the array and the factory agree. */
export const configs: {
  readonly framework: Linter.Config[]
  readonly author: Linter.Config[]
  readonly tooling: Linter.Config[]
} = {
  framework: framework(),
  author: author(),
  tooling: tooling(),
}

const plugin = {
  meta,
  rules,
  configs,
  framework,
  author,
  tooling,
  DEFAULT_ROUTER_FILES,
  DEFAULT_TOOLING_FILES,
}

export default plugin
