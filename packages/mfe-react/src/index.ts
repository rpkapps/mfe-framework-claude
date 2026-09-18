/**
 * `@company/mfe-react` — the author and host surface.
 *
 * The getting-started surface is deliberately tiny: `createApp` or
 * `createWidget`, an `id`, your own route tree, and the generated `#mfe/config`
 * and `#mfe/fetch` modules. Everything else here is discovered when a need
 * arises, and is absent from the quickstart.
 *
 * Nothing in the public API is named after the framework where a plain name
 * works: `useCommand` and `useBreadcrumbs`, not `useMfeCommands`. The `useMfe*`
 * prefix is reserved for the imperative storage accessor and the mount signal,
 * where the qualifier genuinely disambiguates.
 */

/* Definitions — the one call an author makes in src/mfe.ts */
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

/* Router contract */
export {
  RESERVED_CONTEXT_KEYS,
  type AppRouterOptions,
  type MfeContext,
  type MfeRouterContext,
  type MfeStaticData,
  type ReservedContextKey,
} from './router-contract.ts'

/* Hosting Apps and Widgets */
export {
  AppHost,
  mfeRoute,
  type AppFallbackProps,
  type AppHostProps,
  type MfeRouteOptions,
} from './app-host.tsx'

export {
  lazyWidget,
  type LazyWidgetOptions,
  type LazyWidgetProps,
  type WidgetFallbackProps,
} from './lazy-widget.tsx'

/* Shell-state hooks, live in Apps and independently mounted Widgets alike */
export { useGroups, useTheme, useUser } from './hooks/shell-state.ts'

/* Service hooks */
export { useBasePath, useMfeSignal, useMfeStorage, useTelemetry } from './hooks/services.ts'
export { useCommand } from './hooks/use-command.ts'
export { useBreadcrumbs } from './hooks/use-breadcrumbs.ts'
export {
  useStoredState,
  type StoredStateSetter,
  type UseStoredStateOptions,
} from './hooks/use-stored-state.ts'

/**
 * Framework-owned telemetry and tracing types and constants.
 *
 * These are re-exported from the neutral core rather than aliased from a vendor
 * package: an author's declarations and bundles must never have to resolve
 * `@opentelemetry/*` or `@grafana/faro-*`.
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

export { MfeProvider, useMfeRuntime, type MfeProviderProps } from './runtime-context.tsx'
export { AppMount, type AppMountProps } from './app-mount.tsx'
export { SCOPE_ATTRIBUTE, createOverlayRoot } from './scope-root.tsx'
export type { MfeMount, MfeRuntime } from './runtime.ts'
