/**
 * The `framework` preset: for the packages that implement the MFE framework
 * itself, that is @company/mfe-core, @company/mfe-host, @company/mfe-react,
 * @company/mfe-legacy-angular and @company/mfe-rspack.
 *
 * Framework code is held to the package import DAG on top of the shared
 * correctness rules: the neutral packages stay neutral, and no framework package
 * takes a state-management or vendor-telemetry dependency on behalf of every
 * consumer.
 */

import type { Linter } from 'eslint'
import {
  TS_FILES,
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
  MODULE_FEDERATION_PATTERN,
  STATE_PATHS,
  TELEMETRY_PATTERNS,
  neutralPackagePaths,
  restrictedImports,
  type RestrictedPath,
  type RestrictedPattern,
} from './restricted-imports.ts'

export interface FrameworkPresetOptions {
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
   * Files allowed to touch Web Storage directly: the framework storage adapter,
   * and a documented shell bootstrap that deliberately overrides it.
   */
  readonly storageAllowedScopes?: readonly string[] | undefined
  /** Globs of Widget-owned sources, if the package under lint ships Widgets. */
  readonly widgetScopes?: readonly string[] | undefined
  /** Extra restricted paths appended to every zone. */
  readonly extraRestrictedPaths?: readonly RestrictedPath[] | undefined
  /** Extra restricted patterns appended to every zone. */
  readonly extraRestrictedPatterns?: readonly RestrictedPattern[] | undefined
}

/**
 * Per-package zones. Each entry mirrors one rule of
 * `tools/boundaries/check-boundaries.mjs`, so a developer meets in the editor
 * the same boundary CI enforces from the manifests.
 */
function packageZones(
  files: readonly string[],
  extraPaths: readonly RestrictedPath[],
  extraPatterns: readonly RestrictedPattern[],
): Linter.Config[] {
  const basePaths = [...STATE_PATHS, ...extraPaths]
  const basePatterns = [...TELEMETRY_PATTERNS, ...extraPatterns]

  return [
    {
      name: 'mfe/zone/mfe-core',
      files: intersectFiles(files, '**/packages/mfe-core/**'),
      plugins: typeScriptPlugins,
      rules: {
        '@typescript-eslint/no-restricted-imports': restrictedImports(
          [
            ...neutralPackagePaths('@company/mfe-core'),
            {
              name: '@company/mfe-host',
              message:
                'Package boundary: the host depends on the core, never the other way round. Move the shared contract into @company/mfe-core and let the host import it.',
            },
            {
              name: '@company/mfe-react',
              message:
                'Package boundary: the React adapter depends on the core, never the other way round. Keep React-shaped code in @company/mfe-react.',
            },
            ...basePaths,
          ],
          [...basePatterns, MODULE_FEDERATION_PATTERN],
        ),
      },
    },
    {
      name: 'mfe/zone/mfe-host',
      files: intersectFiles(files, '**/packages/mfe-host/**'),
      plugins: typeScriptPlugins,
      rules: {
        '@typescript-eslint/no-restricted-imports': restrictedImports(
          [
            ...neutralPackagePaths('@company/mfe-host'),
            {
              name: '@company/mfe-react',
              message:
                'Package boundary: the host mounts adapters through the neutral lifecycle contract in @company/mfe-core. Importing the React adapter would make React a host dependency and break the Angular adapter.',
            },
            ...basePaths,
          ],
          [...basePatterns, MODULE_FEDERATION_PATTERN],
        ),
      },
    },
    {
      name: 'mfe/zone/mfe-react',
      files: intersectFiles(files, '**/packages/mfe-react/**'),
      plugins: typeScriptPlugins,
      rules: {
        '@typescript-eslint/no-restricted-imports': restrictedImports(
          [
            {
              name: 'single-spa',
              message:
                'Package boundary: only @company/mfe-legacy-angular knows the legacy single-spa contract.',
            },
            ...basePaths,
          ],
          basePatterns,
        ),
      },
    },
    {
      name: 'mfe/zone/mfe-legacy-angular',
      files: intersectFiles(files, '**/packages/mfe-legacy-angular/**'),
      plugins: typeScriptPlugins,
      rules: {
        '@typescript-eslint/no-restricted-imports': restrictedImports(
          [
            {
              name: 'react',
              message:
                'Package boundary: the legacy adapter is a sibling of the React adapter, not a consumer of it.',
            },
            {
              name: 'react-dom',
              message:
                'Package boundary: the legacy adapter is a sibling of the React adapter, not a consumer of it.',
            },
            {
              name: '@tanstack/react-router',
              message: 'Package boundary: the legacy adapter does not depend on the React router.',
            },
            {
              name: '@company/mfe-react',
              message:
                'Package boundary: the legacy adapter is a sibling of the React adapter, not a consumer of it. Share code through @company/mfe-core.',
            },
            ...basePaths,
          ],
          basePatterns,
        ),
      },
    },
  ]
}

/** Builds the `framework` preset. */
export function framework(options: FrameworkPresetOptions = {}): Linter.Config[] {
  const files = options.files ?? TS_FILES
  const reactFiles = resolveReactFiles(files, options.reactFiles)
  const storageAllowedScopes = options.storageAllowedScopes ?? []
  const widgetScopes = options.widgetScopes ?? []
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
    {
      name: 'mfe/framework/state-and-telemetry',
      files: [...files],
      plugins: typeScriptPlugins,
      rules: {
        '@typescript-eslint/no-restricted-imports': restrictedImports(
          [...STATE_PATHS, ...extraPaths],
          [...TELEMETRY_PATTERNS, ...extraPatterns],
        ),
      },
    },
    ...packageZones(files, extraPaths, extraPatterns),
    {
      name: 'mfe/framework/rules',
      files: [...files],
      plugins: { mfe: mfePlugin },
      rules: {
        'mfe/no-global-patching': 'error',
        'mfe/stable-definitions': 'error',
        'mfe/no-raw-storage': ['error', { allowedScopes: [...storageAllowedScopes] }],
        'mfe/no-widget-global-effects': ['error', { widgetScopes: [...widgetScopes] }],
      },
    },
    testScopeOverrides(files, 'mfe/framework/tests'),
  ]
}
