/**
 * The `author` preset, for MFE Apps and Widgets: application state libraries are expected, while
 * framework internals, the React root and a telemetry SDK are not an author's to own.
 */

import type { Linter } from 'eslint'
import queryPlugin from '@tanstack/eslint-plugin-query'
import routerPlugin from '@tanstack/eslint-plugin-router'
import {
  TS_FILES,
  asConfigs,
  asyncCorrectness,
  eslintRecommended,
  intersectFiles,
  languageConfig,
  maintainability,
  mfePlugin,
  reactCorrectness,
  resolveReactFiles,
  typeCheckedConfigs,
  testScopeOverrides,
  typeSafety,
  typeScriptPlugins,
  withFiles,
  type PresetOptions,
} from './shared.ts'
import {
  AUTHOR_FRAMEWORK_PATHS,
  AUTHOR_FRAMEWORK_PATTERNS,
  AUTHOR_TELEMETRY_PATTERNS,
  restrictedImports,
} from './restricted-imports.ts'

const DEFAULT_ROUTER_FILES: readonly string[] = [
  '**/routes/**/*.{ts,tsx}',
  '**/*.route.{ts,tsx}',
  '**/*.routes.{ts,tsx}',
  '**/router.{ts,tsx}',
  '**/routeTree.gen.ts',
]

export interface AuthorPresetOptions extends PresetOptions {
  readonly routerFiles?: readonly string[] | undefined
}

export function author(options: AuthorPresetOptions = {}): Linter.Config[] {
  const files = options.files ?? TS_FILES
  const reactFiles = resolveReactFiles(files, options.reactFiles)
  const routerFiles = options.routerFiles ?? DEFAULT_ROUTER_FILES
  const widgetScopes = options.widgetScopes ?? []
  const storageAllowedScopes = options.storageAllowedScopes ?? []
  const extraPaths = options.extraRestrictedPaths ?? []
  const extraPatterns = options.extraRestrictedPatterns ?? []

  return [
    eslintRecommended(files),
    languageConfig({ tsconfigRootDir: options.tsconfigRootDir, files }),
    ...withFiles(typeCheckedConfigs, files, 'mfe/typescript-recommended'),
    asyncCorrectness(files),
    typeSafety(files),
    maintainability(files),
    ...reactCorrectness(reactFiles),
    ...withFiles(asConfigs(queryPlugin.configs['flat/recommended']), files, 'mfe/tanstack-query'),
    // Never outside the files the preset covers: that is where the parser is set.
    ...withFiles(
      asConfigs(routerPlugin.configs['flat/recommended']),
      routerFiles.flatMap(scope => intersectFiles(files, scope)),
      'mfe/tanstack-router',
    ),
    {
      name: 'mfe/author/boundaries',
      files: [...files],
      plugins: typeScriptPlugins,
      rules: {
        // The application state libraries are deliberately absent: an MFE owns its own state.
        '@typescript-eslint/no-restricted-imports': restrictedImports(
          [...AUTHOR_FRAMEWORK_PATHS, ...extraPaths],
          [...AUTHOR_FRAMEWORK_PATTERNS, ...AUTHOR_TELEMETRY_PATTERNS, ...extraPatterns],
        ),
      },
    },
    {
      name: 'mfe/author/rules',
      files: [...files],
      plugins: { mfe: mfePlugin },
      rules: {
        'mfe/no-global-patching': 'error',
        'mfe/stable-definitions': 'error',
        'mfe/no-raw-storage': ['error', { allowedScopes: [...storageAllowedScopes] }],
        'mfe/no-widget-global-effects': ['error', { widgetScopes: [...widgetScopes] }],
      },
    },
    {
      name: 'mfe/author/generated',
      files: [
        ...intersectFiles(files, '**/routeTree.gen.ts'),
        ...intersectFiles(files, '**/src/generated/**'),
      ],
      plugins: typeScriptPlugins,
      rules: {
        // Reviewing generated output is the generator's job, not the author's.
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    testScopeOverrides(files, 'mfe/author/tests'),
  ]
}
