/**
 * The `author` preset, for MFE Apps and Widgets. An author's constraints mirror
 * the framework's: application state libraries are expected, while reaching into
 * framework internals, owning the React root, shipping a telemetry SDK or
 * writing raw Web Storage each turn a fragment into something page-shaped.
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
} from './shared.ts'
import {
  AUTHOR_FRAMEWORK_PATHS,
  AUTHOR_FRAMEWORK_PATTERNS,
  AUTHOR_TELEMETRY_PATTERNS,
  restrictedImports,
  type RestrictedPath,
  type RestrictedPattern,
} from './restricted-imports.ts'

/** Where TanStack Router code lives by default. */
export const DEFAULT_ROUTER_FILES: readonly string[] = [
  '**/routes/**/*.{ts,tsx}',
  '**/*.route.{ts,tsx}',
  '**/*.routes.{ts,tsx}',
  '**/router.{ts,tsx}',
  '**/routeTree.gen.ts',
]

export interface AuthorPresetOptions {
  /** Root directory for the type-aware program. Defaults to the ESLint CWD. */
  readonly tsconfigRootDir?: string | undefined
  /** Files the preset applies to. Defaults to every TypeScript file. */
  readonly files?: readonly string[] | undefined
  /**
   * Files the React and React Compiler rules apply to, always intersected with
   * `files`. Defaults to `files`; narrow it to the packages that contain React,
   * because elsewhere any API whose name collides with a hook reports falsely.
   */
  readonly reactFiles?: readonly string[] | undefined
  /**
   * Widget-owned sources. `mfe/no-widget-global-effects` reports only inside
   * these globs and is inert with none configured.
   */
  readonly widgetScopes?: readonly string[] | undefined
  /** Files allowed to touch Web Storage directly. */
  readonly storageAllowedScopes?: readonly string[] | undefined
  /** Where the TanStack Router rules apply. */
  readonly routerFiles?: readonly string[] | undefined
  /** Extra restricted paths appended to the author boundary. */
  readonly extraRestrictedPaths?: readonly RestrictedPath[] | undefined
  /** Extra restricted patterns appended to the author boundary. */
  readonly extraRestrictedPatterns?: readonly RestrictedPattern[] | undefined
}

/** Builds the `author` preset. */
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
    // The router rules apply where router code lives, but never outside the
    // files the preset was asked to cover: that is where the parser is set.
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
        // zustand and the other application state libraries are deliberately
        // absent from this list: an MFE owns its own state. What it may not own
        // is the framework's internals, the React root, or a telemetry SDK.
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
        // Generated by the router plugin; reviewing it is the generator's job,
        // not the author's.
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    testScopeOverrides(files, 'mfe/author/tests'),
  ]
}
