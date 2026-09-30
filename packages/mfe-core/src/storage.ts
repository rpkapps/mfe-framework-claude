import type { z } from 'zod'

export type StorageArea = 'local' | 'session'
export type StorageScope = 'definition' | 'instance'

export interface StorageScopeOptions {
  /** Definition-wide by default. Instance state requires a stable host-supplied instanceId. */
  readonly scope?: StorageScope
}

/**
 * A stored record belongs to the browser profile, not to whoever is signed in: it survives a
 * sign-out, and the next user of the profile reads it (§56). Nothing personal belongs in one.
 */
export interface StorageKeyOptions<T> extends StorageScopeOptions {
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
  remove(name: string, options?: StorageScopeOptions): void
  /** Removes only the selected scope; never unrelated shell or third-party keys. */
  clear(options?: StorageScopeOptions): void
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

/** Instance namespaces cannot collide with legacy `<id>:<name>` keys: ids never contain `:`. */
export function physicalStorageKey(
  definitionId: string,
  name: string,
  instanceId?: string,
): string {
  return `${storagePrefix(definitionId, instanceId)}${name}`
}

export function storagePrefix(definitionId: string, instanceId?: string): string {
  return instanceId === undefined
    ? `${definitionId}:`
    : `${instanceStoragePrefix(definitionId)}${instanceId.length}:${instanceId}:`
}

/** Length prefixes make arbitrary instance IDs unambiguous without escaping or dependencies. */
export function instanceStoragePrefix(definitionId: string): string {
  return `:${definitionId.length}:${definitionId}:`
}

/** `status` is explicit so an invalid or unreadable value cannot masquerade as a missing one. */
export type StorageSnapshot<T> =
  | { readonly status: 'value'; readonly value: T }
  | { readonly status: 'default'; readonly value: T }
  | { readonly status: 'error'; readonly error: Error }
