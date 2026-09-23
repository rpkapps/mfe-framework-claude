/**
 * The `tooling` preset, for a workspace's build and test configuration: bundler and test-runner
 * configs, test setup files and the hand-written declarations beside a plain-JavaScript helper.
 * None of it is part of the runtime import DAG, so the MFE rules and the package zones have
 * nothing to say about it — but it is TypeScript a person writes and breaks, so the shared
 * correctness, type-safety and maintainability layers apply exactly as they do to the rest.
 *
 * There are no test-scope exceptions here: the rules the other presets relax in a test are the
 * ones this preset never turns on, or ones a setup file has no occasion to break.
 */

import type { Linter } from 'eslint'
import { intersectFiles, neutralLayers, typeScriptPlugins } from './shared.ts'

/**
 * Where the preset runs when `files` is not set: the configuration files named after the tool
 * that reads them. A file named for the package it belongs to — `src/mfe.config.ts` — is that
 * package's source and belongs to that package's preset, which is why nothing here matches
 * `*.config.ts` on its own.
 */
export const DEFAULT_TOOLING_FILES: readonly string[] = [
  '**/eslint.config.{ts,mts,cts}',
  '**/rsbuild.config.{ts,mts,cts}',
  '**/vite.config.{ts,mts,cts}',
  '**/vitest.config.{ts,mts,cts}',
  '**/vitest.setup.{ts,tsx}',
]

export interface ToolingPresetOptions {
  /** Root directory for the type-aware program; defaults to the ESLint CWD. */
  readonly tsconfigRootDir?: string | undefined
  /** Defaults to {@link DEFAULT_TOOLING_FILES}. */
  readonly files?: readonly string[] | undefined
}

export function tooling(options: ToolingPresetOptions = {}): Linter.Config[] {
  const files = options.files ?? DEFAULT_TOOLING_FILES

  return [
    ...neutralLayers(files, options.tsconfigRootDir),
    {
      name: 'mfe/tooling/matcher-augmentation',
      files: intersectFiles(files, '**/vitest.setup.{ts,tsx}'),
      plugins: typeScriptPlugins,
      rules: {
        // A matcher library reaches the runner's `Assertion` through an interface that extends it
        // and declares nothing of its own; declaration merging accepts no other shape.
        '@typescript-eslint/no-empty-object-type': [
          'error',
          { allowInterfaces: 'with-single-extends' },
        ],
      },
    },
  ]
}
