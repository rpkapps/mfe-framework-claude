/**
 * Composing an Angular host: the neutral runtime with the Angular adapter registered, and the one
 * provider that makes it reachable from every component outside a mount.
 */

import { makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core'
import type { MfeAdapter } from '@company/mfe-core'
import {
  createHostRuntime,
  type CreateHostRuntimeOptions,
  type HostRuntimeHandle,
  type MfeHostRuntime,
} from '@company/mfe-host'

import { MFE_RUNTIME } from '../inject/tokens.ts'
import { angularAdapter } from '../registry/angular-adapter.ts'

/** Provided once, in the host application's providers; every mount carries its own. */
export function provideMfeRuntime(runtime: MfeHostRuntime): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: MFE_RUNTIME, useValue: runtime }])
}

export interface CreateRuntimeOptions extends Omit<CreateHostRuntimeOptions, 'adapters'> {
  /** Further adapters, such as the React adapter for a host that also mounts React containers. */
  readonly adapters?: readonly MfeAdapter[]
}

/** The Angular adapter is always registered; a caller's adapters join it. */
export function createMfeRuntime(options: CreateRuntimeOptions): HostRuntimeHandle {
  return createHostRuntime({ ...options, adapters: [angularAdapter, ...(options.adapters ?? [])] })
}
