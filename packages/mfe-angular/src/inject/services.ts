/** The mount-bound services, each stable for the mount's life, so reading one never subscribes. */

import { HOST_SCOPE, type MfeStorage, type MfeTelemetry } from '@company/mfe-core'

import { injectMfeMount, injectMfeRuntime, injectOptionalMfeMount } from './runtime.ts'

export function injectTelemetry(): MfeTelemetry {
  return injectMfeMount('injectTelemetry()').telemetry
}

/** The mount-disposal signal, for background work the mount starts itself. */
export function injectMfeSignal(): AbortSignal {
  return injectMfeMount('injectMfeSignal()').signal
}

/** The literal boundary prefix, for URLs into external systems; a Widget has none and gets `''`. */
export function injectBasePath(): string {
  return injectMfeMount('injectBasePath()').basePath
}

/**
 * The imperative handle: reading through it does not subscribe, so rendered state uses
 * `injectStoredState`. Outside a mount it reaches the host page's values.
 */
export function injectMfeStorage(): MfeStorage {
  const mount = injectOptionalMfeMount()
  if (mount !== null) return mount.storage
  return injectMfeRuntime('injectMfeStorage()').storage.forCaller({ owner: HOST_SCOPE })
}
