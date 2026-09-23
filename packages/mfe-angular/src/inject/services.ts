/** The mount-bound services, each stable for the mount's life, so reading one never subscribes. */

import type { MfeStorage, MfeTelemetry, StorageArea } from '@company/mfe-core'

import { injectMfeMount } from './runtime.ts'

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

/** The imperative handle: `get()` does not subscribe, so rendered state uses `injectStoredState`. */
export function injectMfeStorage(area: StorageArea = 'local'): MfeStorage {
  const mount = injectMfeMount('injectMfeStorage()')
  return area === 'session' ? mount.storage.session : mount.storage.local
}
