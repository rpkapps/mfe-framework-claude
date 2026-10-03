/** React hooks over the same mount-bound services `context.mfe` gives route callbacks. */

import { HOST_SCOPE, type MfeStorage, type MfeTelemetry } from '@company/mfe-core'
import { useMemo } from 'react'

import { useMfeMount, useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

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

/**
 * The imperative handle, for event handlers and effects: reading through it does not subscribe,
 * so rendered state uses `useStoredState`. Outside a mount it reaches the host page's values.
 */
export function useMfeStorage(): MfeStorage {
  const mount = useOptionalMfeMount()
  const { storage } = useMfeRuntime('useMfeStorage()')
  return useMemo(() => mount?.storage ?? storage.forCaller({ owner: HOST_SCOPE }), [mount, storage])
}

/**
 * The element carrying this mount's scope attributes, which its scoped stylesheet matches. The
 * runtime creates it around the mount's element; read it to measure the mount's region or to
 * give a library a container inside the scope, never to replace or restyle it.
 */
export function useScopeRoot(): HTMLElement {
  return useMfeMount('useScopeRoot').scopeRoot
}
