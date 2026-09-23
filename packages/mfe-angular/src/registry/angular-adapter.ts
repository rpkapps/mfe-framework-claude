/**
 * The adapter for entries an Angular container's build publishes. `detect` recognises exactly the
 * entries whose `mfe` marker names Angular, so an Angular entry never falls to the React adapter,
 * which reads every other framework entry; `parse` is as strict as the React adapter's.
 */

import type { MfeAdapter } from '@company/mfe-core'
import type { FederatedRegistryEntry } from '@company/mfe-host'

import { entrySchema, gateContractMajor, invalidEntry, isRecord } from './entry-schema.ts'

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

  parse: raw => {
    const id = isRecord(raw) && typeof raw['id'] === 'string' ? raw['id'] : '<unknown>'

    gateContractMajor(id, raw)

    const result = entrySchema.safeParse(raw)
    if (!result.success) throw invalidEntry(id, result.error)

    const parsed = result.data

    return {
      id: parsed.id,
      definitionKind: parsed.kind,
      adapter: ANGULAR_ADAPTER_KIND,
      manifestUrl: parsed.manifestUrl,
      container: parsed.container,
      ...(parsed.expose === undefined ? {} : { expose: parsed.expose }),
      ...(parsed.version === undefined ? {} : { version: parsed.version }),
      ...(parsed.capabilities === undefined ? {} : { capabilities: parsed.capabilities }),
      ...(parsed.contract === undefined ? {} : { contract: parsed.contract }),
      ...(parsed.build === undefined ? {} : { build: parsed.build }),
      ...(parsed.hidden === true ? { hidden: true } : {}),
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      ...(parsed.description === undefined ? {} : { description: parsed.description }),
      ...(parsed.tags === undefined ? {} : { tags: parsed.tags }),
      ...(parsed.icon === undefined ? {} : { icon: parsed.icon }),
    }
  },

  is: (entry): entry is AngularRegistryEntry => entry.adapter === ANGULAR_ADAPTER_KIND,
}
