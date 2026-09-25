/**
 * The adapter for entries a React build publishes. The entry shape is the runtime's, shared with
 * every other framework adapter; what is React's is hiding the router global while a React
 * container evaluates.
 */

import type { MfeAdapter } from '@company/mfe-core'
import { createFederatedAdapter, type FederatedRegistryEntry } from '@company/mfe-runtime'

/** What `entry.adapter` says on everything this adapter parses. */
const REACT_ADAPTER_KIND = 'react'

/**
 * The federation container name and expose path are typed on the entry and reached through
 * `reactAdapter.is(entry)`, never carried as an opaque payload; the federation loader reads the
 * same fields on every adapter's entries.
 */
export interface ReactRegistryEntry extends FederatedRegistryEntry {
  readonly adapter: typeof REACT_ADAPTER_KIND
}

/**
 * Hides `window.__TSR_ROUTER__` while a React container's modules evaluate: the router plugin's
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

export const reactAdapter: MfeAdapter<typeof REACT_ADAPTER_KIND, ReactRegistryEntry> =
  createFederatedAdapter({
    kind: REACT_ADAPTER_KIND,
    // The runtime runs every React container's load inside this, and no other adapter's.
    aroundLoad: withoutCurrentRouterGlobal,
  })
