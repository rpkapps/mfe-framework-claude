/**
 * `@company/mfe-react` — the author and host surface; nothing is named after the framework
 * where a plain name works, so `useMfe*` is reserved for where the qualifier disambiguates.
 */

export {
  createApp,
  createWidget,
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

export {
  useBasePath,
  useMfeSignal,
  useMfeStorage,
  useScopeRoot,
  useTelemetry,
} from './hooks/services.ts'
export { useAction } from './hooks/use-action.ts'
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
  type ActionPlacement,
  type ActionRegistration,
  type BreadcrumbItem,
  type CapabilityDeclaration,
  type CapabilityDescriptor,
  type Decision,
  type MfeError,
  type MfeErrorCode,
  type MfeStorage,
  type MfeStorageKey,
  type ShellState,
  type ShellTheme,
  type ShellUser,
  type StorageKeyOptions,
  type OutputSchema,
  type WidgetContract,
  /* The registry shapes are part of the host surface, because a host renders the registry. */
  type JsonSchemaObject,
  type JsonSchemaValue,
  /* An author reads these inside `useNavigationBlock`, so they belong on the author surface. */
  type BoundaryLocation,
  type NavigationIntent,
  type PublishedContract,
  /* What a shell author needs to write or register an adapter of their own. */
  type MfeAdapter,
  type Registry,
  type RegistryEntry,
  type RejectedRegistryEntry,
} from '@company/mfe-core'

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

export { MfeProvider, useMfeRuntime, type MfeProviderProps } from './runtime-context.tsx'
export { DefinitionIcon, type DefinitionIconProps } from './definition-icon.tsx'
/** Listed in the shell's `adapters`; `/registry` exports it alone, without React. */
export { reactAdapter, type ReactRegistryEntry } from './registry/react-adapter.ts'
/** Exported because the generated container entry imports it (§17). */
export { withStyleRoot, type MfeStyleRoot, type StyleRootProps } from './style-root.ts'
export type { MfeMount, MfeRuntime } from './runtime.ts'

/** The one walk over a Widget's published inputs and outputs, for a host composing the registry (§28). */
export {
  coerceInputs,
  defaultInputsFor,
  describeOutputs,
  describeInputs,
  needsInputPrompt,
  type BuildProvenance,
  type WidgetOutput,
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
  HOST_SCOPE,
  outputNameToHandlerProp,
  outputPayloadSchema,
  type CapabilityName,
  type IconData,
  type IconNode,
} from '@company/mfe-core'
