/**
 * The neutral registry record and the adapter-selection table. Legacy fields
 * such as `mfManifestUrl`, `routes` or `single-spa-app` never appear here: the
 * legacy adapter translates them at its own boundary, which keeps the core free
 * of a compatibility vocabulary it would otherwise carry forever.
 */

import type { CapabilityDescriptor, DefinitionKind, PublishedWidgetContract } from './definition.ts'

/** Which adapter mounts an entry. Extending this is a table entry. */
export type AdapterKind = 'react' | 'legacy-angular'

/** A validated entry the host can act on. */
export interface NeutralRegistryEntry {
  readonly id: string
  readonly definitionKind: DefinitionKind
  readonly adapter: AdapterKind
  readonly manifestUrl: string
  readonly version?: string
  /** App-only. Extracted statically at build time. */
  readonly capabilities?: readonly CapabilityDescriptor[]
  /**
   * Widget-only. What the Widget takes and emits, so a host can offer it in a
   * catalogue and collect its inputs before the container is ever fetched.
   */
  readonly contract?: PublishedWidgetContract
  /** Excluded from catalog and finder views. Not a security boundary. */
  readonly hidden?: boolean
  readonly title?: string
  readonly icon?: string
  /** Adapter-private payload, so the neutral shape above stays framework-free. */
  readonly adapterData?: unknown
  /** True when a developer override replaced `manifestUrl` at boot. */
  readonly overridden?: boolean
}

/** An entry that failed validation. It is quarantined, not dropped silently. */
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

/**
 * One selection rule, evaluated in order: a valid advertised contract picks the
 * new adapter, required legacy metadata without one picks the legacy adapter,
 * and a malformed advertised contract fails explicitly rather than falling
 * through to legacy, which would change loading behaviour invisibly.
 */
export interface AdapterSelectionRule<TSource = unknown> {
  readonly adapter: AdapterKind
  /** Does this entry advertise this adapter's contract at all? */
  readonly advertises: (source: TSource) => boolean
  /** Translate and validate. Throwing produces a per-entry quarantine. */
  readonly normalize: (source: TSource) => NeutralRegistryEntry
}

/** The framework contract major this build implements. */
export const FRAMEWORK_CONTRACT_MAJOR = 1

/** Accepts compatible minors/patches, rejects unsupported majors. */
export function isSupportedContractMajor(major: number): boolean {
  return Number.isInteger(major) && major === FRAMEWORK_CONTRACT_MAJOR
}
