/**
 * `@company/mfe-host` — neutral loading, mounting and shell-service orchestration.
 *
 * Nothing here imports React, a router, single-spa or Module Federation: the
 * container loader is injected through the port in `loader/`, which is what
 * lets the host own lifecycle, retry, deadlines and cleanup without them.
 */

export { normalizeRegistry, type NormalizeRegistryOptions } from './registry/normalize.ts'

export { createMfeContractRule } from './registry/mfe-contract-rule.ts'

export {
  SharedContainerLoader,
  type ContainerLoader,
  type LoadedDefinition,
} from './loader/container-loader.ts'

export {
  MountController,
  type MountControllerOptions,
  type MountOperations,
} from './mount/mount-controller.ts'

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
  type DevOverridesResult,
} from './overrides/dev-overrides.ts'

export * from './storage/index.ts'
export * from './auth/index.ts'
export * from './telemetry/index.ts'

// The provider contract a shell implements. It is defined in mfe-core, but a
// shell depends on this package, not on core, so naming it has to be possible
// from here.
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
