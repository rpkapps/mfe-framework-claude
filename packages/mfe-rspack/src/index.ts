/**
 * `@company/mfe-rspack` — the build side of the MFE framework.
 *
 * Two things live behind this entry point. `mfePlugin()` is the Rspack plugin a
 * container's config adds; `env()` is the one runtime-facing helper, used in
 * `src/mfe.config.ts` to declare what the deployment provides. The package is
 * marked side-effect free so importing `env` never drags the plugin, the
 * TypeScript compiler API or PostCSS into a browser bundle.
 *
 * Everything else exported here is for a host build, a test or a tool: the
 * discovery and generation passes are plain functions, so a repository can run
 * them without a compiler.
 */

export { mfePlugin, MfeRspackPlugin, PLUGIN_NAME } from './plugin.ts'

export {
  DEFAULT_GENERATED_DIR,
  DEFAULT_MANIFEST_FILE,
  DEFAULT_REGISTRY_FILE,
  DEFAULT_ROUTES_DIRECTORY,
  DEFAULT_RUNTIME_CONFIG_FILE,
  resolveOptions,
  sanitizeFederationName,
  type ContainerManifest,
  type MfePluginOptions,
  type ResolvedOptions,
} from './options.ts'

export { planContainer, type ContainerPlan, type PlanContainerOptions } from './plan.ts'

export {
  env,
  ENV_NAME_RULE,
  isEnvVarDescriptor,
  type EnvConfigSource,
  type EnvOptions,
  type EnvVarDescriptor,
  type InferEnvConfig,
} from './config/env.ts'

export {
  apiFields,
  CONFIG_MODULE_NAME,
  readConfigSource,
  toEnvName,
  type ConfigField,
  type ConfigSource,
} from './config/config-source.ts'

export {
  readStaticSchema,
  summarizeSchema,
  type JsonObject,
  type JsonSchemaNode,
  type JsonValue,
  type StaticSchema,
} from './config/zod-static.ts'

export {
  createBuildError,
  formatLocation,
  isMfeBuildError,
  MfeBuildError,
  type BuildDiagnosticDetails,
} from './diagnostics.ts'

export {
  DEFAULT_DEFINITION_MODULES,
  discoverDefinitions,
  type ContractImport,
  type ContractImportName,
  type DiscoveredDefinition,
  type DiscoverDefinitionsOptions,
  type DiscoveryResult,
  type SchemaBinding,
  type WidgetContractSource,
} from './discovery/definitions.ts'

export { ENTRY_MODULE_NAMES, resolveEntryModule } from './discovery/entry.ts'

export {
  extractCapabilities,
  routeFiles,
  type ExtractCapabilitiesOptions,
} from './discovery/capabilities.ts'

export {
  containerSourceFiles,
  findStrayDefinitions,
  type StrayDefinitionOptions,
} from './discovery/stray-definitions.ts'

export { findNonContainerAwareAssetReferences } from './assets/relative-references.ts'

export {
  ALIASES,
  assetBaseModule,
  configModule,
  containerDescriptor,
  containerId,
  entryModulePath,
  envExample,
  envExampleFile,
  exposeName,
  federationEntryModules,
  fetchModule,
  frameworkMetadata,
  generateContainerFiles,
  metaModule,
  registryDescriptorFile,
  runtimeConfigSchema,
  runtimeConfigSchemaFile,
  tsconfigPathsFile,
  widgetContractModules,
  writeGeneratedFiles,
  type FrameworkManifestMetadata,
  type GenerateContext,
  type GeneratedFile,
  type GeneratedOutput,
} from './generate/index.ts'

export {
  containerDependencies,
  DEFAULT_SHARED_CANDIDATES,
  isUsableVersionRange,
  resolveShared,
  type ResolveSharedOptions,
  type SharedModuleConfig,
} from './federation/sharing.ts'

export {
  buildFederationOptions,
  MANIFEST_METADATA_KEY,
  withFrameworkMetadata,
  type FederationOptions,
} from './federation/federation-options.ts'

export {
  DEFAULT_SCOPE_ATTRIBUTE,
  splitSelectorList,
  transformScopedCss,
  type ScopedCssOptions,
  type ScopedCssResult,
} from './css/scope-transform.ts'
