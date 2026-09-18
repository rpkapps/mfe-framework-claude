/**
 * Service hooks: React conveniences over the same mount-bound services that
 * route callbacks reach through `context.mfe`.
 *
 * `useTelemetry()` and `context.mfe.telemetry` are the same object, as are
 * `useMfeSignal()` and `context.mfe.signal`. There is no second instance and no
 * global service locator.
 */

import type { MfeStorage, MfeTelemetry } from '@company/mfe-core'
import type { StorageArea } from '@company/mfe-core'

import { useMfeMount } from '../mount-context.tsx'

/** Stable for the mount's lifetime. Emitting telemetry never causes a rerender. */
export function useTelemetry(): MfeTelemetry {
  return useMfeMount('useTelemetry').telemetry
}

/**
 * The mount-disposal signal, for background work started outside a loader.
 *
 * A route loader keeps using its own abort signal for navigation-scoped
 * cancellation; this one only aborts when the whole mount goes away.
 */
export function useMfeSignal(): AbortSignal {
  return useMfeMount('useMfeSignal').signal
}

/**
 * The literal boundary prefix.
 *
 * Almost nothing needs this: `Link` and `navigate` already resolve under the
 * boundary. It exists for the genuine case of building a URL for an external
 * system. Widgets have no boundary, so it returns an empty string for them and
 * that is deliberate rather than an oversight.
 */
export function useBasePath(): string {
  return useMfeMount('useBasePath').basePath
}

/**
 * The imperative storage handle, for reads, migrations and explicit removal.
 *
 * Calling `get()` does not subscribe. Components that render stored state use
 * `useStoredState` instead.
 */
export function useMfeStorage(area: StorageArea = 'local'): MfeStorage {
  const mount = useMfeMount('useMfeStorage')
  return area === 'session' ? mount.storage.session : mount.storage.local
}
