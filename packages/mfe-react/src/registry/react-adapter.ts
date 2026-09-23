/**
 * The adapter for entries a React build publishes. `detect` is deliberately loose and `parse`
 * strict, so a typo in a React entry fails here instead of being read as some other kind of
 * container. The entry shape itself is the runtime's `parseFederatedEntry`, shared with every
 * other framework adapter.
 */

import type { MfeAdapter } from '@company/mfe-core'
import { parseFederatedEntry, type FederatedRegistryEntry } from '@company/mfe-runtime'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** An absent framework is a React build from before the field existed. */
function namesReact(marker: unknown): boolean {
  if (!isRecord(marker)) return true
  const framework = marker['framework']
  return framework === undefined || framework === REACT_ADAPTER_KIND
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

export const reactAdapter: MfeAdapter<typeof REACT_ADAPTER_KIND, ReactRegistryEntry> = {
  kind: REACT_ADAPTER_KIND,

  // The `mfe` key is the marker, valid or not: a broken framework entry must never fall to
  // another adapter, because that would change how an application loads unnoticed. Only an
  // entry that names another framework is someone else's, so one built before the field
  // existed, or with a marker too broken to name anything, is still read here and fails in
  // `parse`.
  detect: raw => isRecord(raw) && 'mfe' in raw && namesReact(raw['mfe']),

  // The shape every framework build publishes is read once, by the runtime.
  parse: raw => parseFederatedEntry(raw, REACT_ADAPTER_KIND),

  is: (entry): entry is ReactRegistryEntry => entry.adapter === REACT_ADAPTER_KIND,

  // The runtime runs every React container's load inside this, and no other adapter's.
  aroundLoad: withoutCurrentRouterGlobal,
}
