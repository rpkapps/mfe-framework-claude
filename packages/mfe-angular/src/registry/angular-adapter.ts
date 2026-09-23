/**
 * The adapter for entries an Angular container's build publishes: exactly the entries whose `mfe`
 * marker names Angular, however broken the rest of them is, read by the runtime's one reading of
 * the shape every framework build publishes.
 */

import type { MfeAdapter } from '@company/mfe-core'
import { createFederatedAdapter, type FederatedRegistryEntry } from '@company/mfe-runtime'

/** What `entry.adapter` says on everything this adapter parses, and what `mfe.framework` names. */
const ANGULAR_ADAPTER_KIND = 'angular'

/** Reached through `angularAdapter.is(entry)`, never carried as an opaque payload. */
export interface AngularRegistryEntry extends FederatedRegistryEntry {
  readonly adapter: typeof ANGULAR_ADAPTER_KIND
}

export const angularAdapter: MfeAdapter<typeof ANGULAR_ADAPTER_KIND, AngularRegistryEntry> =
  createFederatedAdapter({ kind: ANGULAR_ADAPTER_KIND })
