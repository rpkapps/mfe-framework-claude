/**
 * The `author` preset: for MFE Apps and Widgets, that is the code in
 * `examples/*` and in every product repository that ships an MFE.
 *
 * An author's constraints are the mirror image of the framework's. Application
 * state libraries are fine, and zustand is expected. Reaching into framework
 * internals, owning the React root, shipping a telemetry SDK or writing raw Web
 * Storage are not, because each of them turns a fragment into something that
 * behaves like the whole page.
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
   * Files the React and React Compiler rules apply to. Defaults to `files`.
   *
   * Narrow it to the packages that actually contain React: a package without
   * React gets false positives from any API whose name collides with a hook,
   * and the repair is to stop applying React rules there rather than to
   * suppress them one by one. Always intersected with `files`.
   */
  readonly reactFiles?: readonly string[] | undefined
  /**
   * Widget-owned sources. `mfe/no-widget-global-effects` reports only inside
   * these globs; with none configured it is inert, because Widget ownership is
   * declared, never inferred from a file name.
   */
  readonly widgetScopes?: readonly string[] | undefined
  /**
   * Files allowed to touch Web Storage directly, normally only a documented
   * shell override bootstrap.
   */
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
    { ...eslintRecommended(), files: [...files] },
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
