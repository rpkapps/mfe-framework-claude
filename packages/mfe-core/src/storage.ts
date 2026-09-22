import type { z } from 'zod'

export type StorageArea = 'local' | 'session'

/**
 * Who a record belongs to, and so who may read it back (§21): a `'browser'` record is read by
 * every user of this browser profile, where a `'user'` record is retired when the identity changes.
 */
export type StorageRetention = 'user' | 'browser'

export interface StorageKeyOptions<T> {
  /** Defaults to `'browser'`; anything derived from a user's data must declare `'user'`. */
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

/** The persisted record; the field names are short because they are written into every key. */
export interface StorageEnvelope {
  readonly v: number
  readonly r: StorageRetention
  /** Opaque session/access generation; absent on `'browser'` records. */
  readonly g?: string
  /** The payload, validated against the author's own schema, not this shape. */
  readonly d: unknown
}

export const DEFAULT_SCHEMA_VERSION = 1
export const DEFAULT_RETENTION: StorageRetention = 'browser'

/** Hand-written so the core bundle need not carry Zod to re-check four fields it wrote itself. */
export function isStorageEnvelope(value: unknown): value is StorageEnvelope {
  if (value === null || typeof value !== 'object') return false
  const { v, r, g } = value as Partial<StorageEnvelope>
  return (
    Number.isInteger(v) &&
    (v as number) > 0 &&
    (r === 'user' || r === 'browser') &&
    (g === undefined || typeof g === 'string') &&
    'd' in value
  )
}

/** Never scoped by mount token, so every mount of a definition reads the same record. */
export function physicalStorageKey(definitionId: string, name: string): string {
  return `${definitionId}:${name}`
}

export function storagePrefix(definitionId: string): string {
  return `${definitionId}:`
}

/** `status` is explicit so an invalid or unreadable value cannot masquerade as a missing one. */
export type StorageSnapshot<T> =
  | { readonly status: 'value'; readonly value: T }
  | { readonly status: 'default'; readonly value: T }
  | { readonly status: 'error'; readonly error: Error }
