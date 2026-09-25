/** The registry entry every adapter produces, and the adapter interface the host reads it through. */

import type {
  BuildProvenance,
  CapabilityDescriptor,
  DefinitionKind,
  IconData,
  PublishedContract,
} from './definition.ts'

/**
 * The fields every entry has, whatever built it. An adapter's own fields are added by its own
 * entry type and reached through its `is()` guard, so nothing here names a framework.
 */
export interface RegistryEntry {
  readonly id: string
  readonly definitionKind: DefinitionKind
  /** The `kind` of the adapter that parsed the entry, so a view can name it without asking. */
  readonly adapter: string
  readonly manifestUrl: string
  readonly version?: string
  /** App-only; extracted statically at build time. */
  readonly capabilities?: readonly CapabilityDescriptor[]
  /** Widget-only; a host offers the Widget in a catalogue before its container is fetched (§16). */
  readonly contract?: PublishedContract
  /** Which build the entry came from, readable without loading the container (§29). */
  readonly build?: BuildProvenance
  /** Excluded from catalogue and finder views; not a security boundary. */
  readonly hidden?: boolean
  readonly title?: string
  readonly description?: string
  /** Free-form, author-declared; the catalogue filters on them and never interprets them. */
  readonly tags?: readonly string[]
  /** A string is a short text mark the host draws itself; `IconData` is a parsed icon. */
  readonly icon?: string | IconData
  /** True when a developer override replaced `manifestUrl` at boot. */
  readonly overridden?: boolean
}

/**
 * One adapter per kind of container. `detect` and `parse` are deliberately split: detection is
 * cheap and total, so a broken entry is still recognised by the adapter it was built for and
 * fails there rather than being read as something else.
 *
 * Exactly one adapter must recognise an entry. None and the entry is rejected as unrecognised,
 * more than one and it is rejected as ambiguous, so there is no order to register adapters in.
 *
 * Mounting needs nothing from the adapter: every definition mounts itself through its own
 * `mount`, whichever host places it. Loading may need one thing, `aroundLoad`.
 */
export interface MfeAdapter<K extends string = string, E extends RegistryEntry = RegistryEntry> {
  /** What `entry.adapter` says on everything this adapter parses. */
  readonly kind: K
  /** Cheap, and total: bad input returns false rather than throwing. */
  detect(raw: unknown): boolean
  /**
   * Strict. Throws an `MfeError` coded `registry/invalid-entry`, or
   * `contract/unsupported-major`, carrying `path`, `expected`, `observed` and `repair`.
   */
  parse(raw: unknown): E
  /** How a caller gets back to this adapter's own fields without a cast. */
  is(entry: RegistryEntry): entry is E
  /**
   * Wraps loading a container whose entry this adapter parsed, for page state the container's
   * modules must not see while they evaluate. It runs once per load that actually happens, not
   * once per caller waiting on it, and must return what `load` resolved to.
   */
  aroundLoad?<T>(load: () => Promise<T>, entry: RegistryEntry): Promise<T>
}

/** An entry that could not be read; rejected with a reason rather than dropped silently. */
export interface RejectedRegistryEntry {
  /** Best-effort: the `id` if one could be read, otherwise a positional label. */
  readonly id: string
  readonly reason: string
  readonly error: Error
  readonly source: unknown
}

export interface Registry {
  readonly entries: ReadonlyMap<string, RegistryEntry>
  readonly rejected: readonly RejectedRegistryEntry[]
}

export const FRAMEWORK_CONTRACT_MAJOR = 1

export function isSupportedContractMajor(major: number): boolean {
  return Number.isInteger(major) && major === FRAMEWORK_CONTRACT_MAJOR
}
