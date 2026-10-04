/**
 * `@company/mfe-angular` — the Angular author and host surface. Everything runs zoneless: each
 * mount is its own application with its own change-detection scheduler, and nothing here imports
 * or needs `zone.js`.
 */

export {
  createApp,
  createWidget,
  type AppDefinition,
  type AppOptions,
  type MfeDefinition,
  type WidgetDefinition,
  type WidgetOptions,
} from './definition.ts'

export { MFE_ROUTE_DATA, mfeRouteData, type MfeRouteData } from './routing/route-data.ts'
export { mfeAppRoute, type MfeAppRouteOptions } from './routing/app-route.ts'
export { BoundaryLocationStrategy } from './routing/boundary-location-strategy.ts'
export { breadcrumbsFromSnapshot } from './routing/breadcrumbs-from-routes.ts'

export { MFE_MOUNT, MFE_RUNTIME, WIDGET_EMIT } from './inject/tokens.ts'
export { injectMfeMount, injectMfeRuntime, injectOptionalMfeMount } from './inject/runtime.ts'
export { injectGroups, injectTheme, injectUser } from './inject/shell-state.ts'
export { injectSession, type MfeSession } from './inject/session.ts'
export { injectBasePath, injectMfeSignal, injectTelemetry } from './inject/services.ts'
export {
  injectStoredState,
  type InjectStoredStateOptions,
  type ReadonlyStoredState,
  type StoredState,
} from './inject/stored-state.ts'
export { injectAction } from './inject/action.ts'
export {
  injectAgentContext,
  injectAgentPrompt,
  injectAgentSuggestions,
} from './inject/agent-context.ts'
export { injectBreadcrumbs } from './inject/breadcrumbs.ts'
export {
  injectNavigationBlock,
  type NavigationBlock,
  type NavigationBlockOptions,
  type ShouldBlockNavigation,
} from './inject/navigation-block.ts'
export { injectWidgetEmit, type WidgetEmit } from './inject/widget-emit.ts'

// The core's public API, whole: the types and values an App, a Widget or a shell names.
export * from '@company/mfe-core/public'

/* Placing definitions from an Angular shell or App; a shell composes the page from `/host`. */
export { provideMfeRuntime } from './host/provide-runtime.ts'
export { MfeWidgetComponent, type MfeWidgetOutput } from './host/widget.component.ts'
export { MfeAppHostComponent } from './host/app-host.component.ts'
export type { MountStatus } from './host/hosted-mount.ts'
export type { MfeFallbackContext } from './host/fallback-context.ts'
export { MfeDefinitionIconComponent } from './host/definition-icon.component.ts'
export { createMfeHttpAuthInterceptor, type MfeHttpAuthOptions } from './http/auth-interceptor.ts'
export {
  injectActiveDefinition,
  injectApps,
  injectCapabilityPages,
  injectRegistryEntries,
  injectWidgets,
  type ActiveDefinition,
  type CapabilityPage,
} from './host/registry-selectors.ts'

/** What `injectMfeRuntime()` and `injectMfeMount()` return. */
export type { MfeRuntime, MountContext } from '@company/mfe-runtime'

/** What the run `injectAction` returns resolves to, and its type. */
export type { ActionExecutionResult, ActionRun } from '@company/mfe-runtime'

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
