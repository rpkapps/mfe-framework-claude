/**
 * The Angular adapter's own API names (`packages/mfe-angular/src/index.ts` and `src/inject/*`),
 * injected into the shared neutral rules' messages so an Angular author is pointed at
 * `@company/mfe-angular`, never at the React hooks those messages default to. Shared between the
 * `angular` author preset and the `framework` preset's override for `packages/mfe-angular/**`,
 * so both name the same APIs the same way.
 */

import type { Linter } from 'eslint'
import { DEFAULT_MODULES as STABLE_DEFINITIONS_DEFAULT_MODULES } from '../rules/stable-definitions.ts'

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

/**
 * The three MFE rules whose repair names an Angular API instead of the React hooks they default
 * to: `no-global-patching`, `stable-definitions` and `no-raw-storage`. The `framework` preset's
 * override for `packages/mfe-angular/**` and the `angular` author preset both spread this, so a new
 * Angular option is added once, not twice.
 */
export function angularMfeRules(storageAllowedScopes: readonly string[]): Linter.RulesRecord {
  return {
    'mfe/no-global-patching': [
      'error',
      {
        signalHook: ANGULAR_SIGNAL_HOOK,
        signalModule: ANGULAR_ADAPTER_MODULE,
        navigationHint: ANGULAR_NAVIGATION_HINT,
        navigatorModule: ANGULAR_NAVIGATOR_MODULE,
      },
    ],
    'mfe/stable-definitions': [
      'error',
      { modules: [...STABLE_DEFINITIONS_DEFAULT_MODULES, ANGULAR_ADAPTER_MODULE] },
    ],
    'mfe/no-raw-storage': [
      'error',
      {
        allowedScopes: [...storageAllowedScopes],
        storedStateHook: ANGULAR_STORED_STATE_HOOK,
        storageHook: ANGULAR_STORAGE_HOOK,
        adapterModule: ANGULAR_ADAPTER_MODULE,
      },
    ],
  }
}
