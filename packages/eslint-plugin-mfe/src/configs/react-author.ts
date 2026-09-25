/**
 * The `react` author preset, for MFE Apps and Widgets built on `@company/mfe-react`: application
 * state libraries are expected, while framework internals, the React root and a telemetry SDK are
 * not an author's to own.
 */

import type { Linter } from 'eslint'
import {
  asConfigs,
  authorBase,
  intersectFiles,
  mfePlugin,
  resolveReactFiles,
  testScopeOverrides,
  typeScriptPlugins,
  withFiles,
  type PresetOptions,
} from './shared.ts'
import { reactCorrectness } from './react-support.ts'
import { loadTanstackPeers } from './react-peers.ts'
import {
  applicationBoundaryPaths,
  authorAgentLibraries,
  authorTelemetryPatterns,
  deepImportPattern,
  MODULE_FEDERATION_PATTERN,
  restrictedImports,
  singleSpaPattern,
} from './restricted-imports.ts'

/**
 * Where TanStack Router's own rules run when `routerFiles` is not set. Exported because a
 * repository that widens the list usually means to add to these rather than replace them.
 */
export const DEFAULT_ROUTER_FILES: readonly string[] = [
  '**/routes/**/*.{ts,tsx}',
  '**/*.route.{ts,tsx}',
  '**/*.routes.{ts,tsx}',
  '**/router.{ts,tsx}',
  '**/routeTree.gen.ts',
]

const ADAPTER_MODULE = '@company/mfe-react'

const REACT_ROOT_MESSAGE =
  'Lifecycle boundary: the host owns the React root. An MFE that calls `createRoot` itself detaches from the mount lifecycle, so unmount, error boundaries and hydration stop working. Export a definition from `createApp` or `createWidget` and let the host mount it.'

export interface AuthorPresetOptions extends PresetOptions {
  readonly routerFiles?: readonly string[] | undefined
}

export function author(options: AuthorPresetOptions = {}): Linter.Config[] {
  const base = authorBase(options, 'author', ['**/routeTree.gen.ts'])
  const { files, widgetScopes, storageAllowedScopes, extraPaths, extraPatterns } = base
  const reactFiles = resolveReactFiles(files, options.reactFiles)
  const routerFiles = options.routerFiles ?? DEFAULT_ROUTER_FILES

  const { queryPlugin, routerPlugin } = loadTanstackPeers()

  return [
    ...base.layers,
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
          [
            ...applicationBoundaryPaths([ADAPTER_MODULE]),
            { name: 'react-dom/client', message: REACT_ROOT_MESSAGE },
            ...authorAgentLibraries(ADAPTER_MODULE, 'useAction()').paths,
            ...extraPaths,
          ],
          [
            deepImportPattern([ADAPTER_MODULE]),
            singleSpaPattern([ADAPTER_MODULE]),
            MODULE_FEDERATION_PATTERN,
            ...authorTelemetryPatterns(
              ADAPTER_MODULE,
              'useTelemetry()',
              'or `context.mfe.telemetry` in a route callback',
            ),
            ...authorAgentLibraries(ADAPTER_MODULE, 'useAction()').patterns,
            ...extraPatterns,
          ],
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
    base.generated,
    testScopeOverrides(files, 'mfe/author/tests'),
  ]
}
