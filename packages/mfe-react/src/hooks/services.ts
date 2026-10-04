/** React hooks over the same mount-bound services `context.mfe` gives route callbacks. */

import type { MfeTelemetry } from '@company/mfe-core'

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

/**
 * The element carrying this mount's scope attributes, which its scoped stylesheet matches. The
 * runtime creates it around the mount's element; read it to measure the mount's region or to
 * give a library a container inside the scope, never to replace or restyle it.
 */
export function useScopeRoot(): HTMLElement {
  return useMfeMount('useScopeRoot').scopeRoot
}
