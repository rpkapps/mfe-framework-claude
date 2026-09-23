/**
 * Composing an Angular host: the neutral runtime with the Angular adapter registered, and the one
 * provider that makes it reachable from every component outside a mount.
 */

import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core'
import type { MfeAdapter } from '@company/mfe-core'
import {
  // Aliased because this module's own `createMfeRuntime` wraps it under the same name.
  createMfeRuntime as createNeutralRuntime,
  type CreateMfeRuntimeOptions,
  type MfeRuntime,
  type MfeRuntimeHandle,
} from '@company/mfe-runtime'

import { MFE_RUNTIME } from '../inject/tokens.ts'
import { angularAdapter } from '../registry/angular-adapter.ts'

/** Provided once, in the host application's providers; every mount carries its own. */
export function provideMfeRuntime(runtime: MfeRuntime): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: MFE_RUNTIME, useValue: runtime }])
}

export interface CreateRuntimeOptions extends Omit<CreateMfeRuntimeOptions, 'adapters'> {
  /** Further adapters, such as the React adapter for a host that also mounts React containers. */
  readonly adapters?: readonly MfeAdapter[]
}

/** The Angular adapter is always registered; a caller's adapters join it. */
export function createMfeRuntime(options: CreateRuntimeOptions): MfeRuntimeHandle {
  return createNeutralRuntime({
    ...options,
    adapters: [angularAdapter, ...(options.adapters ?? [])],
  })
}
