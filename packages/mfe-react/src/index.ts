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
  type WidgetInputFallbackProps,
} from './lazy-widget.tsx'

export { useGroups, useTheme, useUser } from './hooks/shell-state.ts'

export { useBasePath, useMfeSignal, useScopeRoot, useTelemetry } from './hooks/services.ts'
export { useAction } from './hooks/use-action.ts'
export { useAgentContext, useAgentPrompt, useAgentSuggestions } from './hooks/use-agent-context.ts'

/** What the run `useAction` returns resolves to, and its type. */
export type { ActionExecutionResult, ActionRun } from '@company/mfe-runtime'
export { useBreadcrumbs } from './hooks/use-breadcrumbs.ts'
export {
  useNavigationBlock,
  type NavigationBlock,
  type ShouldBlockNavigation,
} from './hooks/use-navigation-block.ts'
export {
  useStoredState,
  type ReadonlyStoredState,
  type StoredState,
  type UseStoredStateOptions,
} from './hooks/use-stored-state.ts'

// The core's public API, whole: the types and values an App, a Widget or a shell names.
export * from '@company/mfe-core/public'

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

export {
  useActiveDefinition,
  useApps,
  useCapabilityPages,
  useRegistryEntries,
  useWidgets,
  type ActiveDefinition,
  type CapabilityPage,
} from './registry-selectors.ts'
