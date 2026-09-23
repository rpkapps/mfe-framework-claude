// TypeScript, so ESLint loads it — and the plugin's own `.ts` sources behind
// it — through jiti, on whatever Node an editor happens to bundle.
import type { Linter } from 'eslint'

import mfe from '@company/eslint-plugin-mfe'
import angular from '@company/eslint-plugin-mfe/angular'

// Typed, because the repository's own eslint.config.ts imports this one to lint the example.
const config: Linter.Config[] = [
  { ignores: ['dist/**', '.mfe/**'] },
  ...angular.angular({
    tsconfigRootDir: import.meta.dirname,
    files: ['src/**/*.ts'],
    // Widget ownership is declared, never guessed: this container's whole `src/` is the Widget's
    // own scope for a Widget template, and nothing is for an App, which owns the boundary router.
    widgetScopes: [],
  }),
  // This file, and the webpack and vitest config beside it.
  ...mfe.tooling({
    tsconfigRootDir: import.meta.dirname,
    files: [...mfe.DEFAULT_TOOLING_FILES, 'webpack.config.ts'],
  }),
]

export default config
