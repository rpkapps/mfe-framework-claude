/**
 * `@company/eslint-plugin-mfe` — the framework-neutral entry: the four (five, with the Router
 * analogue) MFE rules, the package-boundary and TS-strictness layers, and the repository's own
 * `framework` and `tooling` presets. The `react` and `angular` author presets live at their own
 * subpaths (`@company/eslint-plugin-mfe/react`, `/angular`) so that importing this entry, or
 * calling `framework()`/`tooling()`/`application()`, never demands the peer either one needs.
 */

import type { Linter } from 'eslint'
import { rules } from './rules/index.ts'
import { application, type ApplicationPresetOptions } from './configs/application.ts'
import { framework, type FrameworkPresetOptions } from './configs/framework.ts'
import { tooling, DEFAULT_TOOLING_FILES, type ToolingPresetOptions } from './configs/tooling.ts'

export { rules }
export { application, framework, tooling }
export { DEFAULT_TOOLING_FILES }
export type { ApplicationPresetOptions, FrameworkPresetOptions, ToolingPresetOptions }
export type { RestrictedPath, RestrictedPattern } from './configs/restricted-imports.ts'

export const meta = { name: '@company/eslint-plugin-mfe', version: '0.1.0' } as const

/**
 * The presets called with their defaults, so the array and the factory agree. `framework` is
 * computed lazily (a getter, not a plain property): `framework()` needs `eslint-plugin-react-hooks`
 * (an optional peer), and building it eagerly at module-import time would demand that peer just to
 * `import mfe from '@company/eslint-plugin-mfe'`, before anyone touched `configs.framework` at all.
 */
export const configs: {
  readonly framework: Linter.Config[]
  readonly tooling: Linter.Config[]
} = Object.defineProperties(
  {},
  {
    framework: { enumerable: true, get: () => framework() },
    tooling: { enumerable: true, get: () => tooling() },
  },
) as { readonly framework: Linter.Config[]; readonly tooling: Linter.Config[] }

const plugin = {
  meta,
  rules,
  configs,
  framework,
  tooling,
  application,
  DEFAULT_TOOLING_FILES,
}

export default plugin
