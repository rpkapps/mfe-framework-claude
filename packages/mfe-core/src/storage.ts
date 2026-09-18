/**
 * Browser-storage contracts and the persisted envelope. An author declares the
 * payload; the framework wraps it with the schema version, retention class and
 * session generation, so retention and migration decisions come from the record
 * itself rather than from a parallel index that can drift.
 */

import { z } from 'zod'

export type StorageArea = 'local' | 'session'

/**
 * Orthogonal to `StorageArea` on purpose: a preference may live in
 * `localStorage` and survive a logout, while a scoped filter in the same store
 * must not.
 */
const retentionSchema = z.enum(['session', 'preference'])
export type StorageRetention = z.infer<typeof retentionSchema>

export interface StorageKeyOptions<T> {
  readonly retention?: StorageRetention
  readonly version?: number
  /** Synchronous, side-effect-free conversion from a known older version. */
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

export interface MfeStorageKey<T> {
  /** Returns `null` only for a missing key — never for an invalid one. */
  get(): T | null
  set(value: T): void
  remove(): void
}

export interface MfeStorage {
  key<T>(name: string, schema: z.ZodType<T>, options?: StorageKeyOptions<T>): MfeStorageKey<T>
  remove(name: string): void
  /** Removes only the exact `<id>:` prefix; never unrelated shell or third-party keys. */
  clear(): void
}

/**
 * The persisted record. Field names are short because they are written to every
 * key; their meaning is fixed here and nowhere else.
 */
const storageEnvelopeSchema = z.object({
  /** Schema version the payload was written against. */
  v: z.int().positive(),
  /** Retention class, so a store-wide session reset can act on the record alone. */
  r: retentionSchema,
  /** Opaque session/access generation; absent on preference records. */
  g: z.string().optional(),
  /** The payload, validated against the author's own schema, not this one. */
  d: z.unknown(),
})

export type StorageEnvelope = z.infer<typeof storageEnvelopeSchema>

export const DEFAULT_SCHEMA_VERSION = 1
export const DEFAULT_RETENTION: StorageRetention = 'session'

export function isStorageEnvelope(value: unknown): value is StorageEnvelope {
  return storageEnvelopeSchema.safeParse(value).success
}

/** Physical key layout: `<id>:<key>`. Never scoped by mount token. */
export function physicalStorageKey(definitionId: string, name: string): string {
  return `${definitionId}:${name}`
}

export function storagePrefix(definitionId: string): string {
  return `${definitionId}:`
}

/**
 * A subscriber's view of a stored value. `status` is explicit because an
 * invalid or unreadable value must not masquerade as a missing one.
 */
export type StorageSnapshot<T> =
  | { readonly status: 'value'; readonly value: T }
  | { readonly status: 'default'; readonly value: T }
  | { readonly status: 'error'; readonly error: Error }
