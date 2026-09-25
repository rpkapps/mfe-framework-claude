/**
 * The package import DAG as `no-restricted-imports` zones: `tools/boundaries/check-boundaries.mjs`
 * is the mechanical backstop, and these are the version a developer meets in the editor.
 */

import type { Linter } from 'eslint'

export interface RestrictedPath {
  readonly name: string
  readonly message: string
  readonly allowTypeImports?: boolean
  /** Restricts only these named imports from `name`, rather than the whole module. */
  readonly importNames?: readonly string[]
}

export interface RestrictedPattern {
  readonly group: readonly string[]
  readonly message: string
  readonly allowTypeImports?: boolean
}

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
  'Package boundary: framework packages do not take a general state-management dependency, because it would be forced on every consumer and duplicated once per MFE. Model framework state with the primitives in @company/mfe-core (`Subscribable`) and @company/mfe-runtime (`SnapshotSource`) instead.'

const TELEMETRY_MESSAGE =
  'Telemetry boundary: the vendor telemetry SDK is shell-owned, and a framework package that imports it pins one version for the whole page. Emit through the neutral telemetry contract in @company/mfe-core (`MfeTelemetry`) and let the shell adapt it to OpenTelemetry or Faro. Type-only imports are restricted too: they still couple this package to the vendor and still leak into its published declarations.'

/**
 * `telemetryHook` and `extra` are the adapter-specific part: React reads it as `useTelemetry()`
 * plus its route-callback alternative, Angular as `injectTelemetry()` with no such alternative.
 */
function authorTelemetryMessage(
  adapterModule: string,
  telemetryHook: string,
  extra?: string,
): string {
  const alternative = extra === undefined ? '' : `, ${extra}`
  return `Telemetry boundary: an MFE does not ship its own telemetry SDK, because two SDKs in one page mean two trace contexts and twice the bundle. Use the framework telemetry export instead: \`${telemetryHook}\` from ${adapterModule}${alternative}. Type-only imports are restricted too.`
}

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
 * `allowTypeImports` stays false on purpose: a type import still couples the package to the
 * vendor's release cadence and still shows up in the published declarations.
 */
export const TELEMETRY_PATTERNS: readonly RestrictedPattern[] = [
  { group: ['@opentelemetry/*'], message: TELEMETRY_MESSAGE, allowTypeImports: false },
  {
    group: ['@grafana/faro', '@grafana/faro-*'],
    message: TELEMETRY_MESSAGE,
    allowTypeImports: false,
  },
]

/**
 * The application-facing telemetry ban, parameterised by adapter so both author presets (and any
 * `application()` config that wants it) name the right hook and module.
 */
export function authorTelemetryPatterns(
  adapterModule: string,
  telemetryHook: string,
  extra?: string,
): RestrictedPattern[] {
  const message = authorTelemetryMessage(adapterModule, telemetryHook, extra)
  return [
    { group: ['@opentelemetry/*'], message, allowTypeImports: false },
    { group: ['@grafana/faro', '@grafana/faro-*'], message, allowTypeImports: false },
  ]
}

/**
 * The AI and agent libraries, and the model providers' SDKs. A bare name is a path, matched
 * exactly: as a pattern, `ai` would also match any import whose last segment is `ai`, `./ai`
 * included. Everything else is a pattern, which catches a subpath too (`@company/mfe-agent/actions`).
 */
const AGENT_LIBRARY_NAMES = ['ai', 'openai', 'langchain'] as const
const AGENT_LIBRARY_GROUPS = [
  '@tanstack/ai',
  '@tanstack/ai-*',
  'ai/*',
  '@ai-sdk/*',
  '@ag-ui/*',
  '@copilotkit/*',
  '@anthropic-ai/*',
  'openai/*',
  '@google/genai',
  'langchain/*',
  '@langchain/*',
  '@mastra/*',
  // The shell's connection to the agent: an agent library of our own, for the host only.
  '@company/mfe-agent',
] as const

/** The one protocol `@company/mfe-agent` speaks, and the package itself. */
const AGENT_PACKAGE_OWN: ReadonlySet<string> = new Set(['@ag-ui/*', '@company/mfe-agent'])

export interface RestrictedImports {
  readonly paths: readonly RestrictedPath[]
  readonly patterns: readonly RestrictedPattern[]
}

/**
 * `allowTypeImports` stays false: a type from one still ties the code to the library's releases
 * and puts it in the published declarations.
 */
function agentLibraries(
  message: string,
  groups: readonly string[] = AGENT_LIBRARY_GROUPS,
): RestrictedImports {
  return {
    paths: AGENT_LIBRARY_NAMES.map(name => ({ name, message, allowTypeImports: false })),
    patterns: [{ group: [...groups], message, allowTypeImports: false }],
  }
}

/** Framework packages run inside every container, so they stay free of an agent library too. */
export const FRAMEWORK_AGENT_LIBRARIES: RestrictedImports = agentLibraries(
  'Agent boundary: a framework package runs inside every container, so it never imports an AI or agent library, not even its types. `@company/mfe-agent` is the one package that talks to the agent, and only the shell imports it; the framework offers it actions (`ActionRegistry`) and never the other way round.',
)

/**
 * `@company/mfe-agent` speaks AG-UI and nothing else, so any backend that speaks it will do: every
 * other agent library stays out of it, whatever the backend runs on.
 */
export const AGENT_PACKAGE_AGENT_LIBRARIES: RestrictedImports = agentLibraries(
  "Agent boundary: @company/mfe-agent speaks AG-UI only (`@ag-ui/*`), so a backend can be swapped for any that speaks it, a .NET one included. A library's own client or format would tie the shell to that library's backend (docs/decisions.md §49).",
  AGENT_LIBRARY_GROUPS.filter(group => !AGENT_PACKAGE_OWN.has(group)),
)

/**
 * An App or Widget never imports one. `offer` names the adapter's way to give the agent something
 * to do: `useAction()` or `injectAction()`.
 */
export function authorAgentLibraries(adapterModule: string, offer: string): RestrictedImports {
  return agentLibraries(
    `Agent boundary: an App or Widget never imports an AI or agent library, not even its types. The shell's chat talks to the agent, and a mount could not reach it anyway, as every mount renders in a root of its own; the library would also be bundled into this container and rebuilt with it on every change. Offer the agent what it may do with \`${offer}\` from ${adapterModule}: the chat lists your actions as its tools.`,
  )
}

export const MODULE_FEDERATION_PATTERN: RestrictedPattern = {
  group: ['@module-federation/*'],
  message:
    'Package boundary: Module Federation is an implementation detail of @company/mfe-rspack and of the loader inside @company/mfe-runtime. Import the loader contract from @company/mfe-core instead of the MF runtime.',
}

function joined(adapterModules: readonly string[]): string {
  return adapterModules.join(' or ')
}

/**
 * The rule forbidding `@company/mfe-core` and `@company/mfe-runtime` in an application — a shell,
 * a container or an example, whichever adapter(s) it is built against. The message points at the
 * adapter: its root for container APIs, `/host` for shell setup, `/testing` for tests. Both author
 * presets build their own `mfe-core`/`mfe-runtime` ban from this, and a shell config can call it
 * directly through the `application()` preset.
 */
export function applicationBoundaryPaths(adapterModules: readonly string[]): RestrictedPath[] {
  const adapters = joined(adapterModules)
  const hosts = adapterModules.map(adapter => `${adapter}/host`).join(' or ')
  const testing = adapterModules.map(adapter => `${adapter}/testing`).join(' or ')
  return [
    {
      name: '@company/mfe-core',
      message: `Public API boundary: @company/mfe-core is a framework-internal contract package whose shape changes with the framework, not with its public API. Everything an application needs, types included, is re-exported from ${adapters}.`,
    },
    {
      name: '@company/mfe-runtime',
      message: `Public API boundary: @company/mfe-runtime is the shell's loader and registry. An application that imports it directly can mount outside the host lifecycle and will leak on unmount. Use the container APIs from ${adapters}, shell setup from ${hosts}, and the test helpers from ${testing}.`,
    },
  ]
}

/** A deep import reaches past an adapter's entry point, plus the neutral packages every adapter shares. */
export function deepImportPattern(adapterModules: readonly string[]): RestrictedPattern {
  const deepPaths = adapterModules.flatMap(adapter => [`${adapter}/src/*`, `${adapter}/dist/*`])
  return {
    group: [...deepPaths, '@company/mfe-core/*', '@company/mfe-runtime/*', '@company/mfe-rspack/*'],
    message: `Public API boundary: a deep import reaches past the package's entry point into files that are free to change in a patch release. Import from the package root, \`${joined(adapterModules)}\`. If something you need is not exported there, that is a framework bug worth filing.`,
  }
}

export function singleSpaPattern(adapterModules: readonly string[]): RestrictedPattern {
  return {
    group: ['single-spa', 'single-spa-*'],
    message: `Package boundary: single-spa is the legacy interop layer, owned by @company/mfe-legacy-angular. A new MFE targets the App and Widget contract in ${joined(adapterModules)}.`,
  }
}
