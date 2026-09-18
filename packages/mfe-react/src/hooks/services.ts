/**
 * Service hooks: React conveniences over the same mount-bound services that
 * route callbacks reach through `context.mfe`. There is no second instance and
 * no global service locator — `useTelemetry()` and `context.mfe.telemetry` are
 * the same object.
 */

import type { MfeStorage, MfeTelemetry, StorageArea } from '@company/mfe-core'

import { useMfeMount } from '../mount-context.tsx'

/** Stable for the mount's lifetime. Emitting telemetry never causes a rerender. */
export function useTelemetry(): MfeTelemetry {
  return useMfeMount('useTelemetry').telemetry
}

/**
 * The mount-disposal signal, for background work started outside a loader. A
 * route loader keeps using its own signal for navigation-scoped cancellation.
 */
export function useMfeSignal(): AbortSignal {
  return useMfeMount('useMfeSignal').signal
}

/**
 * The literal boundary prefix, for the genuine case of building a URL for an
 * external system: `Link` and `navigate` already resolve under the boundary.
 * Widgets have no boundary, so they get `''` by design.
 */
export function useBasePath(): string {
  return useMfeMount('useBasePath').basePath
}

/**
 * The imperative storage handle, for reads, migrations and explicit removal.
 * `get()` does not subscribe; rendering stored state uses `useStoredState`.
 */
export function useMfeStorage(area: StorageArea = 'local'): MfeStorage {
  const mount = useMfeMount('useMfeStorage')
  return area === 'session' ? mount.storage.session : mount.storage.local
}
