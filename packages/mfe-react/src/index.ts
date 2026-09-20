/**
 * `@company/mfe-react` — the author and host surface.
 *
 * The getting-started surface is deliberately tiny: `createApp` or
 * `createWidget`, an `id`, your own route tree, and the generated `#mfe/config`
 * and `#mfe/fetch` modules. Nothing is named after the framework where a plain
 * name works, so `useMfe*` is reserved for where the qualifier disambiguates.
 */

export {
  createApp,
  createWidget,
  isMfeDefinition,
  type AppDefinition,
  type AppOptions,
  type MfeDefinition,
  type WidgetDefinition,
  type WidgetOptions,
  type WidgetRenderProps,
} from './definition.ts'

export {
  RESERVED_CONTEXT_KEYS,
  type AppRouterOptions,
  type MfeContext,
  type MfeRouterContext,
  type MfeStaticData,
  type ReservedContextKey,
} from './router-contract.ts'

export {
  AppHost,
  mfeRoute,
  type AppFallbackProps,
  type AppHostProps,
  type MfeRouteOptions,
} from './app-host.tsx'

export {
  DynamicWidget,
  lazyWidget,
  type DynamicWidgetProps,
  type LazyWidgetOptions,
  type LazyWidgetProps,
  type WidgetFallbackProps,
} from './lazy-widget.tsx'

export { useGroups, useTheme, useUser } from './hooks/shell-state.ts'

export { useBasePath, useMfeSignal, useMfeStorage, useTelemetry } from './hooks/services.ts'
export { useCommand } from './hooks/use-command.ts'
export { useBreadcrumbs } from './hooks/use-breadcrumbs.ts'
export {
  useNavigationBlock,
  type NavigationBlock,
  type ShouldBlockNavigation,
} from './hooks/use-navigation-block.ts'
export {
  useStoredState,
  type StoredStateSetter,
  type UseStoredStateOptions,
} from './hooks/use-stored-state.ts'

/**
 * Telemetry and tracing come from the neutral core rather than aliased from a
 * vendor package: an author's declarations and bundles must never have to
 * resolve `@opentelemetry/*` or `@grafana/faro-*`.
 */
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
  type MountState,
  type ShellState,
  type ShellTheme,
  type ShellUser,
  type StorageKeyOptions,
  type WidgetContract,
  /*
   * The registry shapes. A host renders the registry — an app finder, a widget
   * catalogue, a diagnostics view — so what a normalized entry and a
   * quarantined one look like is part of the host surface, not an internal.
   */
  type JsonSchemaObject,
  type JsonSchemaValue,
  /*
   * What a mount is told about a navigation it may refuse. An App author reads
   * it inside `useNavigationBlock`, so it belongs on the author surface.
   */
  type BoundaryLocation,
  type NavigationIntent,
  type NeutralRegistryEntry,
  type NormalizedRegistry,
  type PublishedWidgetContract,
  type QuarantinedRegistryEntry,
} from '@company/mfe-core'

/* Shell-facing composition */
export {
  createMfeRuntime,
  createMount,
  type CreateMountOptions,
  type CreateRuntimeOptions,
  type MfeRuntimeHandle,
  type MountHandleWithCleanup,
} from './create-runtime.ts'

/**
 * The authentication seam. `installShellAuth` is the shell's one call; the
 * generated `#mfe/fetch` module is the only caller of `createContainerTransport`
 * and is why both are named here rather than only on the host.
 */
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
} from '@company/mfe-host'

export { MfeProvider, useMfeRuntime, type MfeProviderProps } from './runtime-context.tsx'
export { AppMount, type AppMountProps } from './app-mount.tsx'
export { createMf2ContainerLoader, type Mf2LoaderOptions } from './mf2-loader.ts'
export { SCOPE_ATTRIBUTE, createOverlayRoot } from './scope-root.tsx'
/**
 * Generated plumbing, exported because the generated container entry imports
 * it: the build attaches the design system's root to the definition it exposes,
 * so a container's overlays are wired up by its own copy of the library.
 */
export { withStyleRoot, type MfeStyleRoot, type StyleRootProps } from './style-root.ts'
export type { MfeMount, MfeRuntime } from './runtime.ts'
