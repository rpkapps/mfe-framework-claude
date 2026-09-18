/**
 * Browser-storage contracts and the persisted envelope (§5.13, §5.13.1).
 *
 * The public value an author declares is the payload. The framework wraps it in
 * an envelope carrying the schema version, the retention class and an opaque
 * session generation, so retention and migration decisions are made from the
 * record itself rather than from a parallel index that can drift.
 */

import type { ContractSchema } from './contract.ts'

export type StorageArea = 'local' | 'session'

/**
 * `storage` selects the browser store; `retention` independently selects data
 * lifetime. They are orthogonal on purpose (§5.13.1): a preference may live in
 * `localStorage` and survive a logout, while a scoped filter in the same store
 * must not.
 */
export type StorageRetention = 'session' | 'preference'

export interface StorageKeyOptions<T> {
  readonly retention?: StorageRetention
  readonly version?: number
  /** Synchronous, side-effect-free conversion from a known older version. */
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

export interface MfeStorageKey<T> {
  /** Returns `null` only for a missing key — never for an invalid one (§5.13). */
  get(): T | null
  set(value: T): void
  remove(): void
}

export interface MfeStorage {
  key<T>(
    name: string,
    schema: ContractSchema<T>,
    options?: StorageKeyOptions<T>,
  ): MfeStorageKey<T>
  remove(name: string): void
  /** Removes only the exact `<id>:` prefix; never unrelated shell or third-party keys. */
  clear(): void
}

/**
 * The persisted record. Field names are short because they are written to every
 * key; their meaning is fixed here and nowhere else.
 *
 * - `v` — schema version the payload was written against.
 * - `r` — retention class, so a store-wide session reset can act on the record alone.
 * - `g` — opaque session/access generation; `undefined` for preference records.
 * - `d` — the validated payload.
 */
export interface StorageEnvelope {
  readonly v: number
  readonly r: StorageRetention
  readonly g?: string
  readonly d: unknown
}

export const DEFAULT_SCHEMA_VERSION = 1
export const DEFAULT_RETENTION: StorageRetention = 'session'

export function isStorageEnvelope(value: unknown): value is StorageEnvelope {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<StorageEnvelope>
  return (
    typeof candidate.v === 'number' &&
    (candidate.r === 'session' || candidate.r === 'preference') &&
    (candidate.g === undefined || typeof candidate.g === 'string') &&
    'd' in candidate
  )
}

/** Physical key layout: `<id>:<key>` (§5.13). Never scoped by mount token. */
export function physicalStorageKey(definitionId: string, name: string): string {
  return `${definitionId}:${name}`
}

export function storagePrefix(definitionId: string): string {
  return `${definitionId}:`
}

/**
 * The declaration a key binding carries. Active declarations for one key must
 * agree on all of these; disagreement fails explicitly rather than resolving to
 * whichever hook rendered first (§5.13).
 */
export interface StorageKeyDeclaration<T = unknown> {
  readonly name: string
  readonly area: StorageArea
  readonly schema: ContractSchema<T>
  readonly retention: StorageRetention
  readonly version: number
  readonly defaultValue?: T
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

/**
 * A subscriber's view of a stored value. `status` is explicit because an
 * invalid or unreadable value must not masquerade as a missing one (§5.13).
 */
export type StorageSnapshot<T> =
  | { readonly status: 'value'; readonly value: T }
  | { readonly status: 'default'; readonly value: T }
  | { readonly status: 'error'; readonly error: Error }
