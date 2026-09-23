/**
 * An integration states what differs in a `ContainerProfile` and calls `planContainer`; the rest
 * is the building blocks its own bundler glue and generated files are made of. `env` is also a
 * subpath, and the share scope is `./federation`, so neither loads the compiler.
 */

export { createContainerPlanner, planContainer } from './plan.ts'
export type { ContainerPlan } from './plan.ts'
export { applyContainerCompilation } from './compilation.ts'
export type {
  BundlerCompilation,
  BundlerCompiler,
  ContainerCompilationOptions,
} from './compilation.ts'
export type {
  CapabilityContext,
  ContainerProfile,
  ExposedDefinition,
  StylesheetProfile,
} from './profile.ts'
export { resolveContainerPath } from './options.ts'
export type { ContainerOptions, ResolvedOptions } from './options.ts'

export { createBuildError, isMfeBuildError, listNames, MfeBuildError } from './diagnostics.ts'
export type { BuildDiagnosticDetails } from './diagnostics.ts'

export { env } from './config/env.ts'
export type { EnvOptions, EnvVarDescriptor, InferEnvConfig } from './config/env.ts'
export type { ConfigField, ConfigSource } from './config/config-source.ts'

export { collectCapabilities } from './discovery/capabilities.ts'
export type { CapabilityMarker, CapabilityOwner, MarkerTerms } from './discovery/capabilities.ts'
export type {
  DefinitionSyntax,
  DiscoveredDefinition,
  DiscoveryResult,
} from './discovery/definitions.ts'
export { findExportedExpression, resolveRelativeModule } from './discovery/local-modules.ts'
export type { ContainerSources } from './discovery/sources.ts'
export { isTestFile } from './discovery/stray-definitions.ts'
export {
  calleeName,
  callsTo,
  collectImportedBindings,
  collectTopLevelBindings,
  describeNode,
  importedLocals,
  objectProperty,
  parseSourceFile,
  positionOf,
  propertyName,
  stringLiteralValue,
  ts,
  unwrapExpression,
  walk,
} from './discovery/ts-ast.ts'
export type { CallSite, ImportedBinding } from './discovery/ts-ast.ts'

export {
  banner,
  generatedPath,
  joinBlocks,
  jsonFile,
  quote,
  relativeSpecifier,
  writeGeneratedFiles,
} from './generate/emit.ts'
export type { GeneratedFile } from './generate/emit.ts'
export type { FrameworkManifestMetadata } from './generate/artifacts.ts'
export type { GeneratedOutput } from './generate/index.ts'
export { exportedName } from './generate/modules.ts'
export type { GenerateContext } from './generate/modules.ts'
export { seedLocalRuntimeConfig } from './generate/runtime-config.ts'
export type { LocalRuntimeConfig } from './generate/runtime-config.ts'

export { buildFederationOptions, withFrameworkMetadata } from './federation/federation-options.ts'
export type { FederationOptions } from './federation/federation-options.ts'
export { installedVersionFrom } from './federation/installed-version.ts'
export {
  frameworkShareScope,
  PAGE_SHARE_SCOPE,
  PAGE_SINGLETON,
  packageOf,
  resolveShared,
  shareScopesOf,
  SINGLETON,
} from './federation/sharing.ts'
export type { SharedModuleConfig, SharingPolicies, SharingPolicy } from './federation/sharing.ts'

export { containerPostcssPlugins } from './css/postcss-plugins.ts'
export type { ContainerPostcssOptions } from './css/postcss-plugins.ts'
export { containerScopePlugin } from './css/scope.ts'
export type {
  ContainerScopeOptions,
  ScopeOptions,
  ScopePluginFactory,
  ScopePluginLoader,
} from './css/scope.ts'
export { scopeFallbackPlugin } from './css/scope-fallback.ts'
