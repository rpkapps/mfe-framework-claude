/**
 * `@company/eslint-plugin-mfe/react` — the author preset for React and TanStack containers.
 * `eslint-plugin-react-hooks`, `@tanstack/eslint-plugin-query` and `@tanstack/eslint-plugin-router`
 * are optional peer dependencies of the package: importing this subpath never requires them, only
 * calling `author()` (or reading `configs.author`) does, and a missing one throws a message naming
 * exactly what to install.
 */

import type { Linter } from 'eslint'
import { meta } from './plugin.ts'
import { author, DEFAULT_ROUTER_FILES, type AuthorPresetOptions } from './configs/react-author.ts'

export { author }
export { DEFAULT_ROUTER_FILES }
export type { AuthorPresetOptions }

export { meta }

/** Lazy: building this eagerly at import time would require the React peers just to import the subpath. */
export const configs: { readonly author: Linter.Config[] } = Object.defineProperty({}, 'author', {
  enumerable: true,
  get: () => author(),
}) as { readonly author: Linter.Config[] }

const plugin = {
  meta,
  author,
  configs,
  DEFAULT_ROUTER_FILES,
}

export default plugin
