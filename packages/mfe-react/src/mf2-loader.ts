/**
 * The React adapter's federation loader: the neutral one from the host, plus the one thing only
 * a React shell needs while a container's modules evaluate (§6).
 */

import type { BrandedDefinition, RegistryEntry } from '@company/mfe-core'
import {
  createFederationContainerLoader,
  isFederatedEntry,
  type ContainerLoader,
  type FederationRuntime,
} from '@company/mfe-host'

export interface Mf2LoaderOptions {
  /** Injected so this module has no import-time side effects and tests need no real runtime. */
  readonly runtime: FederationRuntime
}

/** Any adapter's federated entry names its container, so a caller asks here rather than casting. */
export function containerNameOf(entry: RegistryEntry): string | undefined {
  return isFederatedEntry(entry) ? entry.container : undefined
}

/**
 * Hides `window.__TSR_ROUTER__` while a container's modules evaluate: the router plugin's
 * development HMR shim reads it back and, finding the shell's `__root__` registered under the
 * same id, copies the shell's component onto the App that just mounted. It is restored only if
 * nothing published a newer router meanwhile, which would resurrect a stale reference.
 */
async function withoutCurrentRouterGlobal<T>(load: () => Promise<T>): Promise<T> {
  const owner = globalThis as { __TSR_ROUTER__?: unknown }
  if (!('__TSR_ROUTER__' in owner)) return await load()

  const previous = owner.__TSR_ROUTER__
  delete owner.__TSR_ROUTER__

  try {
    return await load()
  } finally {
    if (!('__TSR_ROUTER__' in owner)) owner.__TSR_ROUTER__ = previous
  }
}

/** Loads every adapter's containers, so a React shell can also host an Angular one. */
export function createMf2ContainerLoader(
  options: Mf2LoaderOptions,
): ContainerLoader<BrandedDefinition> {
  return createFederationContainerLoader({
    runtime: options.runtime,
    aroundLoad: withoutCurrentRouterGlobal,
  })
}
