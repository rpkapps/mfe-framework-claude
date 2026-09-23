/**
 * The `framework` preset, for the packages that implement the framework itself: on top of the
 * shared rules it holds them to the package import DAG, so the neutral packages stay neutral.
 */

import type { Linter } from 'eslint'
import {
  TS_FILES,
  intersectFiles,
  mfePlugin,
  neutralLayers,
  resolveReactFiles,
  testScopeOverrides,
  typeScriptPlugins,
  type PresetOptions,
} from './shared.ts'
import { reactCorrectness } from './react-support.ts'
import {
  MODULE_FEDERATION_PATTERN,
  STATE_PATHS,
  TELEMETRY_PATTERNS,
  neutralPackagePaths,
  restrictedImports,
  type RestrictedPath,
  type RestrictedPattern,
} from './restricted-imports.ts'
import { angularMfeRules } from './angular-naming.ts'

export type FrameworkPresetOptions = PresetOptions

const SIBLING =
  'Package boundary: the legacy adapter is a sibling of the React adapter, not a consumer of it. Share code through @company/mfe-core.'

const CORE_STATELESS =
  '@company/mfe-core holds contracts only — types, constants and pure validation. Stateful code (a class other than an Error subclass, module-scope mutable bindings, a timer, or a browser global) belongs in @company/mfe-runtime.'

/**
 * Guards the split that keeps the neutral contract package from becoming a second place state can
 * live. Tests are exempt, because a fixture legitimately builds a `Map` or reads a stubbed global
 * that production code never would.
 */
function coreStatelessZone(files: readonly string[]): Linter.Config {
  return {
    name: 'mfe/zone/mfe-core-stateless',
    files: intersectFiles(files, '**/packages/mfe-core/src/**'),
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/__tests__/**'],
    plugins: typeScriptPlugins,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(ExportNamedDeclaration, ExportDefaultDeclaration) > ClassDeclaration[superClass.name!=/Error$/]',
          message: `Exported class: ${CORE_STATELESS}`,
        },
        {
          selector:
            ':matches(Program, Program > ExportNamedDeclaration) > VariableDeclaration[kind=/^(let|var)$/]',
          message: `Top-level mutable binding: ${CORE_STATELESS}`,
        },
        {
          selector:
            ':matches(Program, Program > ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator > NewExpression[callee.name=/^(Map|Set|WeakMap)$/]',
          message: `Top-level mutable collection: ${CORE_STATELESS}`,
        },
        {
          selector:
            'CallExpression[callee.name=/^(setTimeout|setInterval|queueMicrotask|requestAnimationFrame)$/]',
          message: `Timer call: ${CORE_STATELESS}`,
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: CORE_STATELESS },
        { name: 'document', message: CORE_STATELESS },
        { name: 'localStorage', message: CORE_STATELESS },
        { name: 'sessionStorage', message: CORE_STATELESS },
        { name: 'history', message: CORE_STATELESS },
        { name: 'location', message: CORE_STATELESS },
        { name: 'fetch', message: CORE_STATELESS },
        { name: 'navigator', message: CORE_STATELESS },
      ],
    },
  }
}

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
          name: '@company/mfe-runtime',
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
      'mfe-runtime',
      [
        ...neutralPackagePaths('@company/mfe-runtime'),
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
    ...neutralLayers(files, options.tsconfigRootDir),
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
    coreStatelessZone(files),
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
      // The neutral rules above name React's hooks by default. Inside the Angular adapter's own
      // package, the same rules apply to the same failures, but the repair is an Angular API —
      // this later object wins over the generic one above for any file under this scope.
      name: 'mfe/framework/rules-angular-wording',
      files: intersectFiles(files, '**/packages/mfe-angular/**'),
      plugins: { mfe: mfePlugin },
      rules: angularMfeRules(storageAllowedScopes),
    },
    testScopeOverrides(files, 'mfe/framework/tests'),
  ]
}
