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

interface RouterGlobalGuard {
  pending: number
  readonly restore: () => void
}

const routerGlobalGuards = new WeakMap<object, RouterGlobalGuard>()

/**
 * The router plugin's HMR shim looks up `__root__` even on a route's first evaluation. It must
 * not see another router there, or it copies that router's component onto the new App. An
 * accessor hides reads throughout every overlapping load while remembering routers published
 * by mounts that finish meanwhile. Deleting once cannot hide those writes, and restoring after
 * the first load exposes the shell to containers that are still evaluating.
 */
function hideCurrentRouterGlobal(): RouterGlobalGuard {
  const owner = globalThis as { __TSR_ROUTER__?: unknown }
  const descriptor = Object.getOwnPropertyDescriptor(owner, '__TSR_ROUTER__')
  let latest = owner.__TSR_ROUTER__
  let published = false

  Object.defineProperty(owner, '__TSR_ROUTER__', {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => undefined,
    set: (router: unknown) => {
      latest = router
      published = true
    },
  })

  return {
    pending: 0,
    restore: () => {
      delete owner.__TSR_ROUTER__
      if (descriptor !== undefined) {
        Object.defineProperty(
          owner,
          '__TSR_ROUTER__',
          'value' in descriptor ? { ...descriptor, value: latest } : descriptor,
        )
        if (published && descriptor.set !== undefined) descriptor.set.call(owner, latest)
      } else if (published) {
        owner.__TSR_ROUTER__ = latest
      }
    },
  }
}

async function withoutCurrentRouterGlobal<T>(load: () => Promise<T>): Promise<T> {
  const guard = routerGlobalGuards.get(globalThis) ?? hideCurrentRouterGlobal()
  routerGlobalGuards.set(globalThis, guard)
  guard.pending += 1
  try {
    return await load()
  } finally {
    guard.pending -= 1
    if (guard.pending === 0) {
      guard.restore()
      routerGlobalGuards.delete(globalThis)
    }
  }
}

export const reactAdapter: MfeAdapter<typeof REACT_ADAPTER_KIND, ReactRegistryEntry> =
  createFederatedAdapter({
    kind: REACT_ADAPTER_KIND,
    // The runtime runs every React container's load inside this, and no other adapter's.
    aroundLoad: withoutCurrentRouterGlobal,
  })
