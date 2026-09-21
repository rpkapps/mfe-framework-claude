/** React hooks over the same mount-bound services `context.mfe` gives route callbacks. */

import type { MfeStorage, MfeTelemetry, StorageArea } from '@company/mfe-core'

import { useMfeMount } from '../mount-context.tsx'

/** Stable for the mount's lifetime; emitting telemetry never causes a rerender. */
export function useTelemetry(): MfeTelemetry {
  return useMfeMount('useTelemetry').telemetry
}

/** The mount-disposal signal, for background work started outside a loader. */
export function useMfeSignal(): AbortSignal {
  return useMfeMount('useMfeSignal').signal
}

/** The literal boundary prefix, for URLs into external systems; a Widget has none and gets `''`. */
export function useBasePath(): string {
  return useMfeMount('useBasePath').basePath
}

/** The imperative handle: `get()` does not subscribe, so rendered state uses `useStoredState`. */
export function useMfeStorage(area: StorageArea = 'local'): MfeStorage {
  const mount = useMfeMount('useMfeStorage')
  return area === 'session' ? mount.storage.session : mount.storage.local
}
