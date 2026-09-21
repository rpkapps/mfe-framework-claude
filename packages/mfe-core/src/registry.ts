/** The neutral registry record; legacy fields stay behind the legacy adapter's own boundary. */

import type {
  BuildProvenance,
  CapabilityDescriptor,
  DefinitionKind,
  PublishedWidgetContract,
} from './definition.ts'

/** Which adapter mounts an entry; extending it means adding a selection rule. */
export type AdapterKind = 'react' | 'legacy-angular'

export interface NeutralRegistryEntry {
  readonly id: string
  readonly definitionKind: DefinitionKind
  readonly adapter: AdapterKind
  readonly manifestUrl: string
  readonly version?: string
  /** App-only; extracted statically at build time. */
  readonly capabilities?: readonly CapabilityDescriptor[]
  /** Widget-only; a host offers the Widget in a catalogue before its container is fetched (§16). */
  readonly contract?: PublishedWidgetContract
  /** Which build the entry came from, readable without loading the container (§29). */
  readonly build?: BuildProvenance
  /** Excluded from catalogue and finder views; not a security boundary. */
  readonly hidden?: boolean
  readonly title?: string
  readonly icon?: string
  /** Adapter-private payload, so the neutral shape above stays framework-free. */
  readonly adapterData?: unknown
  /** True when a developer override replaced `manifestUrl` at boot. */
  readonly overridden?: boolean
}

/** An entry that failed validation; quarantined rather than dropped silently. */
export interface QuarantinedRegistryEntry {
  /** Best-effort: the `id` if one could be read, otherwise a positional label. */
  readonly id: string
  readonly reason: string
  readonly error: Error
  readonly source: unknown
}

export interface NormalizedRegistry {
  readonly entries: ReadonlyMap<string, NeutralRegistryEntry>
  readonly quarantined: readonly QuarantinedRegistryEntry[]
}

/** Evaluated in order; a malformed contract fails rather than falling through to legacy. */
export interface AdapterSelectionRule<TSource = unknown> {
  readonly adapter: AdapterKind
  readonly advertises: (source: TSource) => boolean
  /** Throwing produces a per-entry quarantine. */
  readonly normalize: (source: TSource) => NeutralRegistryEntry
}

export const FRAMEWORK_CONTRACT_MAJOR = 1

export function isSupportedContractMajor(major: number): boolean {
  return Number.isInteger(major) && major === FRAMEWORK_CONTRACT_MAJOR
}
