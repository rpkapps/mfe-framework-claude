/**
 * The one provider that makes the page's runtime reachable from every component of an Angular
 * host application outside a mount. A mount carries its own runtime, so nothing inside one needs
 * it.
 */

import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core'
import type { MfeRuntime } from '@company/mfe-runtime'

import { MFE_RUNTIME } from '../inject/tokens.ts'

/** Provided once, in the host application's providers. */
export function provideMfeRuntime(runtime: MfeRuntime): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: MFE_RUNTIME, useValue: runtime }])
}
