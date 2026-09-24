/**
 * The adapter for entries an Angular container's build publishes: exactly the entries whose `mfe`
 * marker names Angular, however broken the rest of them is, read by the runtime's one reading of
 * the shape every framework build publishes.
 */

import {
  createMfeError,
  withoutUndefined,
  type MfeAdapter,
  type MfeError,
  type RegistryEntry,
} from '@company/mfe-core'
import { createFederatedAdapter, type FederatedRegistryEntry } from '@company/mfe-runtime'

/** What `entry.adapter` says on everything this adapter parses, and what `mfe.framework` names. */
const ANGULAR_ADAPTER_KIND = 'angular'

/** Reached through `angularAdapter.is(entry)`, never carried as an opaque payload. */
export interface AngularRegistryEntry extends FederatedRegistryEntry {
  readonly adapter: typeof ANGULAR_ADAPTER_KIND
}

export type AngularAdapter = MfeAdapter<typeof ANGULAR_ADAPTER_KIND, AngularRegistryEntry>

export interface AngularAdapterOptions {
  /**
   * What every Angular container on the page relies on and none of them ships: page-wide
   * stylesheets, fonts. The host decides what that is, so this package names no UI library.
   *
   * It runs once per page, beside the first Angular container's load, and every Angular load waits
   * for it, so no Angular definition mounts before it has settled: the host shows its loading
   * state meanwhile. A rejection fails the load that is waiting, and the next load runs it again.
   */
  readonly pageAssets?: () => Promise<unknown>
}

/** The adapter a host lists to place Angular containers, with what they need of the page. */
export function createAngularAdapter(options: AngularAdapterOptions = {}): AngularAdapter {
  const { pageAssets } = options
  if (pageAssets === undefined) return createFederatedAdapter({ kind: ANGULAR_ADAPTER_KIND })

  // One load for the page, and the loaded assets stay: they are the page's, not a mount's. Only a
  // failure is forgotten, so a retry fetches again rather than replaying the rejection.
  let loading: Promise<unknown> | undefined
  const loadPageAssets = (): Promise<unknown> => {
    loading ??= Promise.resolve()
      .then(pageAssets)
      .catch((cause: unknown) => {
        loading = undefined
        throw cause
      })
    return loading
  }

  return createFederatedAdapter({
    kind: ANGULAR_ADAPTER_KIND,
    // In parallel with the container's own download, so the page assets cost the first Angular
    // load the longer of the two rather than their sum.
    aroundLoad: async (load, entry) => {
      const [loaded] = await Promise.all([
        load(),
        loadPageAssets().catch((cause: unknown) => {
          throw pageAssetsFailure(entry, cause)
        }),
      ])
      return loaded
    },
  })
}

function pageAssetsFailure(entry: RegistryEntry, cause: unknown): MfeError {
  return createMfeError({
    code: 'load/entry-failure',
    id: entry.id,
    ...withoutUndefined({ definitionVersion: entry.version }),
    operation: 'load the page assets every Angular container relies on',
    observed: cause instanceof Error ? cause.message : 'a rejection that is not an Error',
    repair:
      "Check that the host's Angular page assets are reachable; the next attempt loads them again.",
    cause,
  })
}

/** For a host whose Angular containers need nothing of the page. */
export const angularAdapter: AngularAdapter = createAngularAdapter()
