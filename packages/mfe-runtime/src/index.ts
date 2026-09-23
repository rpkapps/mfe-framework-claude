/**
 * `@company/mfe-runtime` — neutral loading, mounting and shell-service orchestration. Nothing
 * here imports React, a router, single-spa or Module Federation: loading goes through the
 * port in `loader/`, and the federation loader there is handed its runtime (§6).
 */

export { readRegistry, type ReadRegistryOptions } from './registry/read-registry.ts'

export {
  SharedContainerLoader,
  type ContainerLoader,
  type LoadedDefinition,
} from './loader/container-loader.ts'

export {
  createFederationContainerLoader,
  federationTarget,
  isFederatedEntry,
  type FederatedRegistryEntry,
  type FederationLoaderOptions,
  type FederationRuntime,
} from './loader/federation-loader.ts'

export {
  createHostRuntime,
  type CreateHostRuntimeOptions,
  type HostRuntimeHandle,
  type MfeHostRuntime,
} from './runtime/host-runtime.ts'

export {
  MountController,
  type MountControllerOptions,
  type MountOperations,
} from './mount/mount-controller.ts'

export {
  createMountContext,
  createMountToken,
  type CreateMountContextOptions,
  type MountContext,
  type MountContextHandle,
} from './mount/mount-context.ts'

/** The neutral self-mounting contract, through which one framework's host mounts another's. */
export {
  isMountableDefinition,
  type AppMountTarget,
  type MountableAppDefinition,
  type MountableDefinition,
  type MountableWidgetDefinition,
  type MountedApp,
  type MountedWidget,
  type WidgetMountTarget,
} from './mount/mountable-definition.ts'

export {
  applyScopeAttributes,
  createOverlayRoot,
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
  type ScopeAttributes,
} from './mount/scope-root.ts'

export {
  requiresSessionRetirement,
  SHELL_STATE_FIELDS,
  ShellStateStore,
  type ShellStateChange,
  type ShellStateField,
  type ShellStateObserver,
  type ShellStatePatch,
} from './shell-state/shell-state-store.ts'

export {
  CommandRegistry,
  type CommandDenialNotifier,
  type CommandExecutionResult,
  type CommandRegistrationHandle,
  type CommandRegistryOptions,
} from './commands/command-registry.ts'

export {
  BreadcrumbStore,
  type BreadcrumbContributionHandle,
  type BreadcrumbStoreOptions,
} from './breadcrumbs/breadcrumb-store.ts'

export {
  BoundaryNavigator,
  boundaryDefinitionId,
  createBrowserNavigationBridge,
  createNavigationIntent,
  parseBoundaryLocation,
  type BoundaryNavigatorOptions,
  type NavigationBlocker,
  type NavigationOutcome,
} from './navigation/boundary-navigator.ts'

export {
  findConflictingContainerOverrides,
  OVERRIDES_STORAGE_KEY,
  readDevOverrides,
  writeDevOverrides,
  type DevOverridesResult,
  type OverrideWritableStorage,
} from './overrides/dev-overrides.ts'

export * from './storage/index.ts'
export * from './auth/index.ts'
export * from './telemetry/index.ts'

// The provider contract a shell implements is defined in mfe-core, but a shell depends on
// this package rather than on core, so naming it has to be possible from here.
export type {
  MeasurementUnit,
  Span,
  SpanRecord,
  SpanStatus,
  TelemetryAttributes,
  TelemetryAttribution,
  TelemetryLevel,
  TelemetryProvider,
  TelemetryRecord,
  Tracer,
} from '@company/mfe-core'

/**
 * Re-exported for the same reason: a shell constructs the hub itself, because
 * `installShellAuth` runs before `createMfeRuntime` exists to make one (§25).
 */
export {
  DiagnosticsHub,
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticsSink,
} from '@company/mfe-core'

export { capabilityRoute } from './registry/capability-route.ts'
