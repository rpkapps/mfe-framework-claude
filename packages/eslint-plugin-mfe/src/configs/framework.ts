/**
 * The `framework` preset, for the packages that implement the framework itself.
 * On top of the shared correctness rules it holds them to the package import
 * DAG: the neutral packages stay neutral, and no framework package takes a
 * state-management or vendor-telemetry dependency for every consumer.
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
   * Files the React and React Compiler rules apply to, always intersected with
   * `files`. Defaults to `files`; narrow it to the packages that contain React,
   * because elsewhere any API whose name collides with a hook reports falsely.
   */
  readonly reactFiles?: readonly string[] | undefined
  /** Files allowed to touch Web Storage directly: the storage adapter, and a
   * documented shell bootstrap that overrides it. */
  readonly storageAllowedScopes?: readonly string[] | undefined
  /** Globs of Widget-owned sources, if the package under lint ships Widgets. */
  readonly widgetScopes?: readonly string[] | undefined
  /** Extra restricted paths appended to every zone. */
  readonly extraRestrictedPaths?: readonly RestrictedPath[] | undefined
  /** Extra restricted patterns appended to every zone. */
  readonly extraRestrictedPatterns?: readonly RestrictedPattern[] | undefined
}

/** A sibling of the React adapter, not a consumer of it. */
const SIBLING =
  'Package boundary: the legacy adapter is a sibling of the React adapter, not a consumer of it. Share code through @company/mfe-core.'

/**
 * Per-package zones. Each mirrors one rule of
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
