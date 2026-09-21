/**
 * The `framework` preset, for the packages that implement the framework itself: on top of the
 * shared rules it holds them to the package import DAG, so the neutral packages stay neutral.
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
  type PresetOptions,
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

export type FrameworkPresetOptions = PresetOptions

const SIBLING =
  'Package boundary: the legacy adapter is a sibling of the React adapter, not a consumer of it. Share code through @company/mfe-core.'

/**
 * Each zone mirrors one rule of `tools/boundaries/check-boundaries.mjs`, so a developer meets in
 * the editor the same boundary CI enforces from the manifests.
 */
function packageZones(
  files: readonly string[],
  extraPaths: readonly RestrictedPath[],
  extraPatterns: readonly RestrictedPattern[],
): Linter.Config[] {
  const basePaths = [...STATE_PATHS, ...extraPaths]
  const basePatterns = [...TELEMETRY_PATTERNS, ...extraPatterns]

  const zone = (
    pkg: string,
    paths: readonly RestrictedPath[],
    patterns: readonly RestrictedPattern[],
  ): Linter.Config => ({
    name: `mfe/zone/${pkg}`,
    files: intersectFiles(files, `**/packages/${pkg}/**`),
    plugins: typeScriptPlugins,
    rules: {
      '@typescript-eslint/no-restricted-imports': restrictedImports(
        [...paths, ...basePaths],
        patterns,
      ),
    },
  })

  return [
    zone(
      'mfe-core',
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
      ],
      [...basePatterns, MODULE_FEDERATION_PATTERN],
    ),
    zone(
      'mfe-host',
      [
        ...neutralPackagePaths('@company/mfe-host'),
        {
          name: '@company/mfe-react',
          message:
            'Package boundary: the host mounts adapters through the neutral lifecycle contract in @company/mfe-core. Importing the React adapter would make React a host dependency and break the Angular adapter.',
        },
      ],
      [...basePatterns, MODULE_FEDERATION_PATTERN],
    ),
    zone(
      'mfe-react',
      [
        {
          name: 'single-spa',
          message:
            'Package boundary: only @company/mfe-legacy-angular knows the legacy single-spa contract.',
        },
      ],
      basePatterns,
    ),
    zone(
      'mfe-legacy-angular',
      [
        { name: 'react', message: SIBLING },
        { name: 'react-dom', message: SIBLING },
        {
          name: '@tanstack/react-router',
          message: 'Package boundary: the legacy adapter does not depend on the React router.',
        },
        { name: '@company/mfe-react', message: SIBLING },
      ],
      basePatterns,
    ),
    zone(
      'mfe-devtools',
      [
        {
          name: '@company/mfe-rspack',
          message:
            'Package boundary: the developer tools read the runtime, never the build integration.',
        },
        {
          name: 'single-spa',
          message:
            'Package boundary: only @company/mfe-legacy-angular knows the legacy single-spa contract.',
        },
      ],
      basePatterns,
    ),
  ]
}

export function framework(options: FrameworkPresetOptions = {}): Linter.Config[] {
  const files = options.files ?? TS_FILES
  const reactFiles = resolveReactFiles(files, options.reactFiles)
  const storageAllowedScopes = options.storageAllowedScopes ?? []
  const widgetScopes = options.widgetScopes ?? []
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
