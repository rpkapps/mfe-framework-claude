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
  ALL_FILES,
  TS_FILES,
  asConfigs,
  asyncCorrectness,
  eslintRecommended,
  languageConfig,
  maintainability,
  mfePlugin,
  reactCorrectness,
  tseslint,
  typeSafety,
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
  extraPaths: readonly RestrictedPath[],
  extraPatterns: readonly RestrictedPattern[],
): Linter.Config[] {
  const basePaths = [...STATE_PATHS, ...extraPaths]
  const basePatterns = [...TELEMETRY_PATTERNS, ...extraPatterns]

  return [
    {
      name: 'mfe/zone/mfe-core',
      files: ['**/packages/mfe-core/**/*.{ts,tsx,mts,cts}'],
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
      files: ['**/packages/mfe-host/**/*.{ts,tsx,mts,cts}'],
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
      files: ['**/packages/mfe-react/**/*.{ts,tsx,mts,cts}'],
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
      files: ['**/packages/mfe-legacy-angular/**/*.{ts,tsx,mts,cts}'],
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
  const storageAllowedScopes = options.storageAllowedScopes ?? []
  const widgetScopes = options.widgetScopes ?? []
  const extraPaths = options.extraRestrictedPaths ?? []
  const extraPatterns = options.extraRestrictedPatterns ?? []

  return [
    { ...eslintRecommended(), files: [...ALL_FILES] },
    languageConfig({ tsconfigRootDir: options.tsconfigRootDir, files }),
    ...withFiles(
      asConfigs(tseslint.configs.recommendedTypeChecked),
      files,
      'mfe/typescript-recommended',
    ),
    asyncCorrectness,
    typeSafety,
    maintainability,
    ...reactCorrectness(files),
    {
      name: 'mfe/framework/state-and-telemetry',
      files: [...files],
      rules: {
        '@typescript-eslint/no-restricted-imports': restrictedImports(
          [...STATE_PATHS, ...extraPaths],
          [...TELEMETRY_PATTERNS, ...extraPatterns],
        ),
      },
    },
    ...packageZones(extraPaths, extraPatterns),
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
    {
      // A test may reach for the very globals the rules above guard, because
      // reaching for them is what it is testing.
      name: 'mfe/framework/tests',
      files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
      rules: {
        'mfe/no-global-patching': 'off',
        'mfe/no-raw-storage': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
      },
    },
  ]
}
