/**
 * The injection tokens the adapter provides. A mount's application injector carries all of them;
 * a host application outside any mount carries only the runtime, through `provideMfeRuntime`.
 */

import { InjectionToken } from '@angular/core'
import type { MfeHostRuntime, MountContext } from '@company/mfe-runtime'

/** The shell's runtime, provided once per host application and by every mount. */
export const MFE_RUNTIME = new InjectionToken<MfeHostRuntime>('MFE_RUNTIME')

/** The mount this application was created for; absent in a host application. */
export const MFE_MOUNT = new InjectionToken<MountContext>('MFE_MOUNT')

/**
 * The validating emit of the Widget mount the injector belongs to. Output subscriptions go
 * through the same function, so a nested component and the Widget's root agree on every rule.
 */
export const WIDGET_EMIT = new InjectionToken<(event: string, payload: unknown) => void>(
  'WIDGET_EMIT',
)
