import type { z } from 'zod'

export type StorageArea = 'local' | 'session'

/**
 * A stored record belongs to the browser profile, not to whoever is signed in: it survives a
 * sign-out, and the next user of the profile reads it (§56). Nothing personal belongs in one.
 */
export interface StorageKeyOptions<T> {
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
  /** The payload, validated against the author's own schema, not this shape. */
  readonly d: unknown
}

export const DEFAULT_SCHEMA_VERSION = 1

/** Hand-written so the core bundle need not carry Zod to re-check two fields it wrote itself. */
export function isStorageEnvelope(value: unknown): value is StorageEnvelope {
  if (value === null || typeof value !== 'object') return false
  const { v } = value as Partial<StorageEnvelope>
  return Number.isInteger(v) && (v as number) > 0 && 'd' in value
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
