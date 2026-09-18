/**
 * The package import DAG and the state/telemetry boundaries as
 * `no-restricted-imports` zones. `tools/boundaries/check-boundaries.mjs` is the
 * mechanical backstop that also reads manifests; these zones are the version a
 * developer meets in the editor, with the repair in the message.
 */

import type { Linter } from 'eslint'

export interface RestrictedPath {
  readonly name: string
  readonly message: string
  readonly allowTypeImports?: boolean
}

export interface RestrictedPattern {
  readonly group: readonly string[]
  readonly message: string
  readonly allowTypeImports?: boolean
}

/** Builds a `@typescript-eslint/no-restricted-imports` entry. */
export function restrictedImports(
  paths: readonly RestrictedPath[],
  patterns: readonly RestrictedPattern[],
): Linter.RuleEntry {
  return [
    'error',
    {
      paths: paths.map(path => ({ ...path })),
      patterns: patterns.map(pattern => ({ ...pattern, group: [...pattern.group] })),
    },
  ]
}

const neutral = (pkg: string, what: string): string =>
  `Package boundary: ${pkg} is framework-neutral, so it cannot depend on ${what}. Put the code that needs it in @company/mfe-react (React) or @company/mfe-legacy-angular (single-spa), and keep the contract in the neutral package.`

const STATE_MESSAGE =
  'Package boundary: framework packages do not take a general state-management dependency, because it would be forced on every consumer and duplicated once per MFE. Model framework state with the primitives in @company/mfe-core (`SnapshotSource`, `Subscribable`) instead.'

const TELEMETRY_MESSAGE =
  'Telemetry boundary: the vendor telemetry SDK is shell-owned, and a framework package that imports it pins one version for the whole page. Emit through the neutral telemetry contract in @company/mfe-core (`MfeTelemetry`) and let the shell adapt it to OpenTelemetry or Faro. Type-only imports are restricted too: they still couple this package to the vendor and still leak into its published declarations.'

const AUTHOR_TELEMETRY_MESSAGE =
  'Telemetry boundary: an MFE does not ship its own telemetry SDK, because two SDKs in one page mean two trace contexts and twice the bundle. Use the framework telemetry exports instead: `useTelemetry()` from @company/mfe-react, or `context.mfe.telemetry` in a route callback. Type-only imports are restricted too.'

/** Packages that must never reach the neutral core or the neutral host. */
export function neutralPackagePaths(pkg: string): RestrictedPath[] {
  return [
    { name: 'react', message: neutral(pkg, 'React') },
    { name: 'react-dom', message: neutral(pkg, 'React DOM') },
    { name: '@tanstack/react-router', message: neutral(pkg, 'a React router') },
    { name: '@tanstack/react-query', message: neutral(pkg, 'a React data client') },
    {
      name: 'single-spa',
      message: `Package boundary: only @company/mfe-legacy-angular knows the legacy single-spa contract, so ${pkg} must not import it.`,
    },
  ]
}

export const STATE_PATHS: readonly RestrictedPath[] = [
  { name: 'zustand', message: STATE_MESSAGE },
  { name: 'redux', message: STATE_MESSAGE },
  { name: '@reduxjs/toolkit', message: STATE_MESSAGE },
  { name: 'react-redux', message: STATE_MESSAGE },
  { name: 'mobx', message: STATE_MESSAGE },
  { name: 'mobx-react-lite', message: STATE_MESSAGE },
  { name: 'jotai', message: STATE_MESSAGE },
  { name: '@tanstack/store', message: STATE_MESSAGE },
  { name: '@tanstack/react-store', message: STATE_MESSAGE },
]

/**
 * Telemetry vendors. `allowTypeImports` stays false on purpose: a type import
 * still couples the package to the vendor's release cadence and still shows up
 * in the published declarations.
 */
export const TELEMETRY_PATTERNS: readonly RestrictedPattern[] = [
  { group: ['@opentelemetry/*'], message: TELEMETRY_MESSAGE, allowTypeImports: false },
  {
    group: ['@grafana/faro', '@grafana/faro-*'],
    message: TELEMETRY_MESSAGE,
    allowTypeImports: false,
  },
]

export const AUTHOR_TELEMETRY_PATTERNS: readonly RestrictedPattern[] = [
  { group: ['@opentelemetry/*'], message: AUTHOR_TELEMETRY_MESSAGE, allowTypeImports: false },
  {
    group: ['@grafana/faro', '@grafana/faro-*'],
    message: AUTHOR_TELEMETRY_MESSAGE,
    allowTypeImports: false,
  },
]

export const MODULE_FEDERATION_PATTERN: RestrictedPattern = {
  group: ['@module-federation/*'],
  message:
    'Package boundary: Module Federation is an implementation detail of @company/mfe-rspack and of the loader inside @company/mfe-host. Import the loader contract from @company/mfe-core instead of the MF runtime.',
}

/** Framework internals an MFE author must not reach into. */
export const AUTHOR_FRAMEWORK_PATHS: readonly RestrictedPath[] = [
  {
    name: '@company/mfe-core',
    message:
      'Public API boundary: @company/mfe-core is a framework-internal contract package whose shape changes with the framework, not with its public API. Everything an MFE author needs, types included, is re-exported from @company/mfe-react.',
  },
  {
    name: '@company/mfe-host',
    message:
      "Public API boundary: @company/mfe-host is the shell's loader and registry. An MFE that imports it can mount itself outside the host lifecycle and will leak on unmount. Use the App and Widget APIs from @company/mfe-react.",
  },
  {
    name: 'react-dom/client',
    message:
      'Lifecycle boundary: the host owns the React root. An MFE that calls `createRoot` itself detaches from the mount lifecycle, so unmount, error boundaries and hydration stop working. Export a definition from `createApp` or `createWidget` and let the host mount it.',
  },
]

export const AUTHOR_FRAMEWORK_PATTERNS: readonly RestrictedPattern[] = [
  {
    group: [
      '@company/mfe-react/src/*',
      '@company/mfe-react/dist/*',
      '@company/mfe-core/*',
      '@company/mfe-host/*',
      '@company/mfe-rspack/*',
    ],
    message:
      "Public API boundary: a deep import reaches past the package's entry point into files that are free to change in a patch release. Import from the package root, `@company/mfe-react`. If something you need is not exported there, that is a framework bug worth filing.",
  },
  {
    group: ['single-spa', 'single-spa-*'],
    message:
      'Package boundary: single-spa is the legacy interop layer, owned by @company/mfe-legacy-angular. A new MFE targets the App and Widget contract in @company/mfe-react.',
  },
  MODULE_FEDERATION_PATTERN,
]
