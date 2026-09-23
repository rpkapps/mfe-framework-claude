/**
 * `@company/mfe-angular` — the Angular author and host surface. Everything runs zoneless: each
 * mount is its own application with its own change-detection scheduler, and nothing here imports
 * or needs `zone.js`.
 */

export {
  createApp,
  createWidget,
  isAngularDefinition,
  type AppDefinition,
  type AppOptions,
  type MfeDefinition,
  type WidgetDefinition,
  type WidgetOptions,
} from './definition.ts'

export type { AngularMountedApp } from './mount/mount-app.ts'
export type { AngularMountedWidget } from './mount/mount-widget.ts'

export { MFE_ROUTE_DATA, mfeRouteData, type MfeRouteData } from './routing/route-data.ts'
export { mfeAppRoute, type MfeAppRouteOptions } from './routing/app-route.ts'
export { BoundaryLocationStrategy } from './routing/boundary-location-strategy.ts'
export { breadcrumbsFromSnapshot } from './routing/breadcrumbs-from-routes.ts'

export { MFE_MOUNT, MFE_RUNTIME, WIDGET_EMIT } from './inject/tokens.ts'
export { injectMfeMount, injectMfeRuntime, injectOptionalMfeMount } from './inject/runtime.ts'
export { injectGroups, injectTheme, injectUser } from './inject/shell-state.ts'
export {
  injectBasePath,
  injectMfeSignal,
  injectMfeStorage,
  injectTelemetry,
} from './inject/services.ts'
export {
  injectStoredState,
  type StoredState,
  type StoredStateOptions,
} from './inject/stored-state.ts'
export { injectCommand } from './inject/command.ts'
export { injectBreadcrumbs } from './inject/breadcrumbs.ts'
export {
  injectNavigationBlock,
  type NavigationBlock,
  type NavigationBlockOptions,
  type ShouldBlockNavigation,
} from './inject/navigation-block.ts'
export { injectWidgetEmit, type WidgetEmit } from './inject/widget-emit.ts'

/** From the core, so an author never resolves `@opentelemetry/*` or `@grafana/faro-*`. */
export {
  SpanKind,
  SpanStatusCode,
  type MeasurementUnit,
  type MfeTelemetry,
  type Span,
  type SpanOptions,
  type SpanStatus,
  type TelemetryAttributes,
  type Tracer,
} from '@company/mfe-core'

/* Neutral contracts an author or host legitimately needs */
export {
  allow,
  deny,
  type BreadcrumbItem,
  type CapabilityDescriptor,
  type CommandPlacement,
  type CommandRegistration,
  type Decision,
  type MfeError,
  type MfeErrorCode,
  type MfeStorage,
  type MfeStorageKey,
  type ShellState,
  type ShellTheme,
  type ShellUser,
  type StorageArea,
  type StorageKeyOptions,
  type WidgetContract,
  /* The registry shapes are part of the host surface, because a host renders the registry. */
  type JsonSchemaObject,
  type JsonSchemaValue,
  /* An author reads these inside `injectNavigationBlock`, so they belong on the author surface. */
  type BoundaryLocation,
  type NavigationIntent,
  type PublishedWidgetContract,
  /* What a shell author needs to write or register an adapter of their own. */
  type MfeAdapter,
  type Registry,
  type RegistryEntry,
  type RejectedRegistryEntry,
} from '@company/mfe-core'

/* Host-facing composition */
export {
  createMfeRuntime,
  provideMfeRuntime,
  type CreateRuntimeOptions,
} from './host/provide-runtime.ts'
export { createMf2ContainerLoader, type Mf2LoaderOptions } from './host/federation-loader.ts'
/** Always registered by `createMfeRuntime`; also on `/registry`, for a shell that is not Angular. */
export { angularAdapter, type AngularRegistryEntry } from './registry/angular-adapter.ts'
export { MfeWidgetComponent, type MfeWidgetEvent } from './host/widget.component.ts'
export { MfeAppHostComponent } from './host/app-host.component.ts'
export { MfeDefinitionIconComponent } from './host/definition-icon.component.ts'
export {
  injectActiveDefinition,
  injectApps,
  injectCapabilityPages,
  injectRegistryEntries,
  injectWidgets,
  type ActiveDefinition,
  type CapabilityPage,
} from './host/registry-selectors.ts'

/** The neutral names a host mounting definitions of more than one framework reads. */
export {
  isFederatedEntry,
  isMountableDefinition,
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
  type FederatedRegistryEntry,
  type HostRuntimeHandle,
  type MfeHostRuntime,
  type MountableDefinition,
  type MountContext,
} from '@company/mfe-runtime'

/** The generated `#mfe/fetch` module is why `createContainerTransport` is named here too. */
export {
  createContainerTransport,
  installShellAuth,
  type AccessTokenOptions,
  type AccessTokenSource,
  type AuthTransport,
  type ContainerAuthBinding,
  type FetchLike,
  type GetAccessToken,
  type ShellAuthOptions,
} from '@company/mfe-runtime'

/** The one walk over a Widget's published inputs, for a host composing the registry. */
export {
  coerceInputs,
  defaultInputsFor,
  describeWidgetInputs,
  needsInputPrompt,
  type BuildProvenance,
  type WidgetInputField,
  type WidgetInputKind,
  type WidgetInputType,
} from '@company/mfe-core'

/** Re-exported from the core because a host depends on this package, not on the core. */
export { HOST_SCOPE, type CapabilityName, type IconData, type IconNode } from '@company/mfe-core'
