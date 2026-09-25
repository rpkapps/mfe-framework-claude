/**
 * `@company/mfe-runtime` — neutral loading, mounting and shell-service orchestration. Nothing
 * here imports React, a router, single-spa or Module Federation: loading goes through the
 * port in `loader/`, and the federation loader there is handed its runtime rather than
 * importing it.
 */

export { readRegistry, type ReadRegistryOptions } from './registry/read-registry.ts'

/** The entry shape every framework build publishes, read once for every adapter's `parse`. */
export {
  createFederatedAdapter,
  parseFederatedEntry,
  type FederatedAdapterOptions,
} from './registry/federated-entry.ts'

/** The listing rules every host applies, which each adapter wraps in its own reactive primitive. */
export {
  activeDefinition,
  capabilityPages,
  listApps,
  listEntries,
  listWidgets,
  type ActiveDefinition,
  type CapabilityPage,
} from './registry/registry-views.ts'

export {
  SharedContainerLoader,
  type ContainerLoader,
  type LoadedDefinition,
} from './loader/container-loader.ts'

export {
  createFederationContainerLoader,
  isFederatedEntry,
  type FederatedRegistryEntry,
  type FederationLoaderOptions,
  type FederationRuntime,
} from './loader/federation-loader.ts'

export {
  createMfeRuntime,
  type CreateMfeRuntimeOptions,
  type MfeRuntime,
  type MfeRuntimeHandle,
} from './runtime/create-runtime.ts'

export {
  MountController,
  type MountControllerOptions,
  type MountOperations,
} from './mount/mount-controller.ts'

export { MountLifecycle, type MountLifecycleOptions } from './mount/mount-lifecycle.ts'

/** How every host mounts every definition, into an element it provides. */
export {
  mountDefinition,
  type AppMountRequest,
  type DefinitionMount,
  type MountRequest,
  type WidgetDefinitionMount,
  type WidgetMountRequest,
} from './mount/mount-definition.ts'

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

/** The provider's half of the Widget boundary, which every adapter's `mount` applies. */
export {
  createProviderEmit,
  validateProviderInputs,
  type ProviderDefinition,
  type ProviderInputs,
} from './mount/provider-boundary.ts'

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
  ActionRegistry,
  type ActionOwner,
  type ActionRegistrationHandle,
  type ActionRegistryOptions,
  type ShortcutDispatchResult,
} from './actions/action-registry.ts'
export {
  type ActionApprovalPolicy,
  type ActionApprover,
  type ActionCall,
  type ActionCaller,
  type ActionDenialNotifier,
  type ActionExecutionResult,
  type ActionRun,
  type ApprovalRequest,
  type ApprovalRuling,
} from './actions/action-executor.ts'

/** The one reading of an action's `shortcut`, for a host that draws or checks one. */
export {
  parseShortcut,
  type ParsedShortcut,
  type ShortcutChord,
  type ShortcutParseResult,
} from './actions/shortcut.ts'

export {
  AgentContextStore,
  MAX_AGENT_CONTEXT_LENGTH,
  type AgentAppLocation,
  type AgentContextHandle,
  type AgentContextOwner,
  type AgentContextStoreOptions,
  type AgentPromptHandler,
  type AgentPromptRequest,
  type AgentTurnContext,
} from './agent-context/agent-context-store.ts'

export {
  BreadcrumbStore,
  type BreadcrumbContributionHandle,
  type BreadcrumbStoreOptions,
} from './breadcrumbs/breadcrumb-store.ts'

/** How an adapter labels and marks the crumbs it derives from its router. */
export { humanizeSegment, withCurrentLast } from './breadcrumbs/breadcrumb-items.ts'

export {
  BoundaryNavigator,
  boundaryDefinitionId,
  confirmUnlessDisposed,
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

export { KeyedListeners, ListenerSet, SnapshotSource } from './observable.ts'

export { DEFAULT_DEADLINES, withDeadline, type DeadlineContext } from './deadline.ts'

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
 * A shell constructs the hub itself, because `installShellAuth` runs before `createMfeRuntime`
 * exists to make one.
 */
export { DiagnosticsHub } from './diagnostics.ts'

/** The sink and event shapes are defined in `@company/mfe-core`, which holds no fan-out itself. */
export type { Diagnostic, DiagnosticSeverity, DiagnosticsSink } from '@company/mfe-core'

export { capabilityRoute } from './registry/capability-route.ts'
