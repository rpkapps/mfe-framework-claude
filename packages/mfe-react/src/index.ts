/**
 * `@company/mfe-react` — the author and host surface; nothing is named after the framework
 * where a plain name works, so `useMfe*` is reserved for where the qualifier disambiguates.
 */

export {
  createApp,
  createWidget,
  isMfeDefinition,
  isReactDefinition,
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
  type StorageKeyOptions,
  type WidgetContract,
  /* The registry shapes are part of the host surface, because a host renders the registry. */
  type JsonSchemaObject,
  type JsonSchemaValue,
  /* An author reads these inside `useNavigationBlock`, so they belong on the author surface. */
  type BoundaryLocation,
  type NavigationIntent,
  type PublishedWidgetContract,
  /* What a shell author needs to write or register an adapter of their own. */
  type MfeAdapter,
  type Registry,
  type RegistryEntry,
  type RejectedRegistryEntry,
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

/** What a shell reads to place a definition another adapter built, or to find its container. */
export {
  isFederatedEntry,
  isMountableDefinition,
  type FederatedRegistryEntry,
  type MountableDefinition,
  type MountContext,
} from '@company/mfe-runtime'

export { MfeProvider, useMfeRuntime, type MfeProviderProps } from './runtime-context.tsx'
export { AppMount, type AppMountProps } from './app-mount.tsx'
export { DefinitionIcon, type DefinitionIconProps } from './definition-icon.tsx'
export { containerNameOf, createMf2ContainerLoader, type Mf2LoaderOptions } from './mf2-loader.ts'
/** Always registered by `createMfeRuntime`; exported so a shell can name it and read its fields. */
export { reactAdapter, type ReactRegistryEntry } from './registry/react-adapter.ts'
export {
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
  createOverlayRoot,
} from './scope-root.tsx'
/** Exported because the generated container entry imports it (§17). */
export { withStyleRoot, type MfeStyleRoot, type StyleRootProps } from './style-root.ts'
export type { MfeMount, MfeRuntime } from './runtime.ts'

/** The one walk over a Widget's published inputs, for a host composing the registry (§28). */
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

export {
  useActiveDefinition,
  useApps,
  useCapabilityPages,
  useRegistryEntries,
  useWidgets,
  type ActiveDefinition,
  type CapabilityPage,
} from './registry-selectors.ts'

/** Re-exported from the core because a host depends on this package, not on the core. */
export {
  eventNameToHandlerProp,
  HOST_SCOPE,
  type CapabilityName,
  type IconData,
  type IconNode,
} from '@company/mfe-core'
