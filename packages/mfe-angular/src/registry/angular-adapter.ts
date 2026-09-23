/**
 * The adapter for entries an Angular container's build publishes. `detect` recognises exactly the
 * entries whose `mfe` marker names Angular, however broken the rest of them is, so an Angular
 * entry is never read by another adapter. `parse` is the runtime's `parseFederatedEntry`, the
 * one reading of the shape every framework build publishes.
 */

import { isRecord, type MfeAdapter } from '@company/mfe-core'
import { parseFederatedEntry, type FederatedRegistryEntry } from '@company/mfe-runtime'

/** What `entry.adapter` says on everything this adapter parses, and what `mfe.framework` names. */
const ANGULAR_ADAPTER_KIND = 'angular'

/** Reached through `angularAdapter.is(entry)`, never carried as an opaque payload. */
export interface AngularRegistryEntry extends FederatedRegistryEntry {
  readonly adapter: typeof ANGULAR_ADAPTER_KIND
}

export const angularAdapter: MfeAdapter<typeof ANGULAR_ADAPTER_KIND, AngularRegistryEntry> = {
  kind: ANGULAR_ADAPTER_KIND,

  // The named framework is the marker, however broken the rest of the entry is: a broken Angular
  // entry must fail here rather than be read by another adapter.
  detect: raw =>
    isRecord(raw) && isRecord(raw['mfe']) && raw['mfe']['framework'] === ANGULAR_ADAPTER_KIND,

  // The shape every framework build publishes is read once, by the runtime.
  parse: raw => parseFederatedEntry(raw, ANGULAR_ADAPTER_KIND),

  is: (entry): entry is AngularRegistryEntry => entry.adapter === ANGULAR_ADAPTER_KIND,
}
