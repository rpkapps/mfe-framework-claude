/**
 * The Angular adapter's own API names (`packages/mfe-angular/src/index.ts` and `src/inject/*`),
 * injected into the shared neutral rules' messages so an Angular author is pointed at
 * `@company/mfe-angular`, never at the React hooks those messages default to. Shared between the
 * `angular` author preset and the `framework` preset's override for `packages/mfe-angular/**`,
 * so both name the same APIs the same way.
 */

export const ANGULAR_ADAPTER_MODULE = '@company/mfe-angular'

/** `injectMfeSignal()`, the abort signal named in the fetch and listener repairs. */
export const ANGULAR_SIGNAL_HOOK = 'injectMfeSignal()'

/** The host navigator stays on the runtime regardless of the container's own adapter. */
export const ANGULAR_NAVIGATOR_MODULE = '@company/mfe-runtime'

export const ANGULAR_NAVIGATION_HINT =
  "the Angular `Router`, scoped to your App's own `BoundaryLocationStrategy`"

export const ANGULAR_STORED_STATE_HOOK = 'injectStoredState()'
export const ANGULAR_STORAGE_HOOK = 'injectMfeStorage()'
export const ANGULAR_TELEMETRY_HOOK = 'injectTelemetry()'

/** How a component inside a Widget's tree reaches `emit`: `injectWidgetEmit()`, not a render prop. */
export const ANGULAR_EMIT_ACCESS = '`injectWidgetEmit()`'
