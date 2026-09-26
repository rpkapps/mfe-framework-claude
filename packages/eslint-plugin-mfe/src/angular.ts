/**
 * `@company/eslint-plugin-mfe/angular` — the author preset for Angular 19 zoneless containers.
 * `@angular-eslint/eslint-plugin`, `@angular-eslint/eslint-plugin-template` and
 * `@angular-eslint/template-parser` are optional peer dependencies of the package: importing this
 * subpath never requires them, only calling `angular()` (or reading `configs.angular`) does, and a
 * missing one throws a message naming exactly what to install.
 */

import type { Linter } from 'eslint'
import { meta } from './plugin.ts'
import {
  angular,
  DEFAULT_ANGULAR_TEMPLATE_FILES,
  type AngularPresetOptions,
} from './configs/angular-author.ts'

export { angular }
export { DEFAULT_ANGULAR_TEMPLATE_FILES }
export type { AngularPresetOptions }

export { meta }

/** Lazy: building this eagerly at import time would require the Angular peers just to import the subpath. */
export const configs: { readonly angular: Linter.Config[] } = Object.defineProperty({}, 'angular', {
  enumerable: true,
  get: () => angular(),
}) as { readonly angular: Linter.Config[] }

const plugin = {
  meta,
  angular,
  configs,
  DEFAULT_ANGULAR_TEMPLATE_FILES,
}

export default plugin
