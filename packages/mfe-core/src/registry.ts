/**
 * The neutral registry record and the adapter-selection table (§8).
 *
 * One normalized registry backs every shell surface. Legacy fields such as
 * `mfManifestUrl`, `routes`, `settings.routes` or `single-spa-app` never appear
 * here: the legacy adapter translates them at its own boundary (§8.3), which is
 * what keeps the core free of a compatibility vocabulary it would otherwise
 * carry forever.
 */

import type { CapabilityDescriptor, DefinitionKind } from './definition.ts'

/** Which adapter mounts an entry. Extending this is a table entry (§12.3). */
export type AdapterKind = 'react' | 'legacy-angular'

/**
 * What a registry entry advertises about its contract. This is the field
 * selection keys off, so a typo produces an explicit error instead of silently
 * changing loading behaviour (§8.2 rule 3).
 */
export interface AdvertisedContract {
  readonly kind: 'mfe'
  /** The framework contract major the container was built against (§11). */
  readonly major: number
}

/** A validated entry the host can act on. */
export interface NeutralRegistryEntry {
  readonly id: string
  readonly definitionKind: DefinitionKind
  readonly adapter: AdapterKind
  readonly manifestUrl: string
  readonly version?: string
  /** App-only. Extracted statically at build time (§5.10). */
  readonly capabilities?: readonly CapabilityDescriptor[]
  /** Excluded from catalog and finder views. Not a security boundary (§4.3). */
  readonly hidden?: boolean
  readonly title?: string
  readonly icon?: string
  /**
   * Adapter-private payload. The React adapter needs nothing here; the legacy
   * adapter parks its translated single-spa metadata in it so the neutral shape
   * above stays framework-free.
   */
  readonly adapterData?: unknown
  /** True when a developer override replaced `manifestUrl` at boot (§10.6). */
  readonly overridden?: boolean
}

/** An entry that failed validation. It is quarantined, not dropped silently (§8.1). */
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
 * One selection rule. Ordered evaluation implements §8.2 exactly:
 *
 * 1. valid advertised new contract  → the new adapter;
 * 2. no advertised new contract but required legacy metadata → the legacy adapter;
 * 3. advertised new contract that is malformed or incompatible → explicit error;
 * 4. neither → quarantine as an invalid descriptor.
 *
 * Rule 3 exists so that a typo in new metadata can never be reinterpreted as
 * legacy, which would change loading behaviour invisibly.
 */
export interface AdapterSelectionRule<TSource = unknown> {
  readonly adapter: AdapterKind
  /** Does this entry advertise this adapter's contract at all? */
  readonly advertises: (source: TSource) => boolean
  /** Translate and validate. Throwing produces a per-entry quarantine (§8.1). */
  readonly normalize: (source: TSource) => NeutralRegistryEntry
}

/** The framework contract major this build implements (§11). */
export const FRAMEWORK_CONTRACT_MAJOR = 1

/** Accepts compatible minors/patches, rejects unsupported majors (§11). */
export function isSupportedContractMajor(major: number): boolean {
  return Number.isInteger(major) && major === FRAMEWORK_CONTRACT_MAJOR
}
