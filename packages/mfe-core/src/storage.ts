import type { z } from 'zod'

import { createMfeError, type MfeError } from './errors.ts'
import { isValidDefinitionId } from './definition.ts'
import { HOST_SCOPE } from './scope.ts'

/**
 * Where a stored value lives. `local` and `session` belong to the browser profile and survive a
 * sign-out, so the next user of the profile reads them (§56); nothing personal belongs there.
 * `user` lives in the shell's backend, per signed-in user.
 */
export type StorageArea = 'local' | 'session' | 'user'
export type BrowserStorageArea = Exclude<StorageArea, 'user'>

/** `loading` and `saving` only occur in the `user` area. */
export type StoredStatus = 'loading' | 'ready' | 'saving' | 'error'

export interface StoredKeyOptions<T> {
  /** `'local'` when omitted. */
  readonly storage?: StorageArea
  /** One value per placed copy, keyed by the host-supplied `instanceId`, instead of one per app. */
  readonly perInstance?: boolean
  /** `1` when omitted; raise it whenever the stored shape changes, and add `migrate`. */
  readonly version?: number
  /** Synchronous, side-effect-free conversion from a known older version. */
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

const STORED_KEY = Symbol.for('@company/mfe.storedKey')

interface StoredKeyFields<T> {
  readonly [STORED_KEY]: true
  readonly name: string
  readonly schema: z.ZodType<T>
  /** What the schema produces for a missing value. */
  readonly defaultValue: T
  readonly storage: StorageArea
  readonly perInstance: boolean
  readonly version: number
  readonly migrate?: (value: unknown, fromVersion: number) => T
}

/** A value the declaring app owns, reads and writes. */
export interface StoredKey<T> extends StoredKeyFields<T> {
  readonly owner?: undefined
}

/** Another app's value: read-only, and the reader brings its own schema and default. */
export interface ReadonlyStoredKey<T> extends StoredKeyFields<T> {
  readonly owner: string
}

export type AnyStoredKey<T> = StoredKey<T> | ReadonlyStoredKey<T>

/** A schema without `.default()` is rejected at the call site, not on first read. */
type WithDefault<S extends z.ZodType> =
  undefined extends z.input<S>
    ? S
    : S & { readonly '~storedKey': 'Give the schema a .default(...)' }

export type StoredUpdate<T> = T | ((previous: T) => T)

/** One key's current state. The value is always a `T`: the schema default while loading or failed. */
export interface StoredSnapshot<T> {
  readonly value: T
  readonly status: StoredStatus
  readonly error: StorageError | undefined
}

export type StorageErrorCode =
  'unauthorized-owner' | 'invalid-value' | 'not-ready' | 'disposed' | 'persistence-failed'

export interface StorageError extends MfeError {
  readonly code: `storage/${StorageErrorCode}`
}

export function createStorageError(
  code: StorageErrorCode,
  id: string,
  name: string,
  operation: string,
  detail: { readonly expected?: string; readonly observed?: string; readonly repair?: string },
  cause?: unknown,
): StorageError {
  return createMfeError({
    code: `storage/${code}`,
    id,
    operation,
    path: [name],
    ...detail,
    ...(cause === undefined ? {} : { cause }),
  }) as StorageError
}

/**
 * What a mount, a route callback or a service reads and writes through, keyed by the same
 * declarations the hooks take. `get` waits for the user area to load; `peek` does not.
 */
export interface MfeStorage {
  get<T>(key: AnyStoredKey<T>): Promise<T>
  peek<T>(key: AnyStoredKey<T>): T
  set<T>(key: StoredKey<T>, next: StoredUpdate<T>): Promise<void>
  /** Removes the stored value, so the key reads its schema default again. */
  reset(key: StoredKey<unknown>): Promise<void>
  subscribe<T>(key: AnyStoredKey<T>, listener: (value: T) => void): () => void
  status(key: AnyStoredKey<unknown>): StoredStatus
}

function declare<T>(
  owner: string | undefined,
  name: string,
  schema: z.ZodType<T>,
  options: StoredKeyOptions<T> = {},
): AnyStoredKey<T> {
  const id = owner ?? '<declaring app>'
  const fail = (expected: string, observed: string, repair: string): never => {
    throw createStorageError('invalid-value', id, String(name), 'declare a stored key', {
      expected,
      observed,
      repair,
    })
  }
  if (typeof name !== 'string' || name.length === 0 || name.includes('@') || name.includes(':'))
    fail(
      'a non-empty key name without "@" or ":"',
      JSON.stringify(name),
      'Name the value, e.g. storedKey("units", ...).',
    )
  if (owner !== undefined && owner !== HOST_SCOPE && !isValidDefinitionId(owner))
    fail(
      'the owning definition id',
      JSON.stringify(owner),
      'Pass the id the owning app is registered under.',
    )
  const version = options.version ?? DEFAULT_SCHEMA_VERSION
  if (!Number.isInteger(version) || version < 1)
    fail(
      'an integer schema version of 1 or more',
      String(options.version),
      'Start at 1 and raise it whenever the stored shape changes, adding migrate().',
    )
  // The schema's own method, so a container's schema is read by the Zod that made it.
  const parsed = schema.safeParse(undefined)
  if (!parsed.success)
    fail(
      'a schema with a default',
      'a schema that rejects a missing value',
      `Give the schema for '${name}' a .default(...).`,
    )
  return Object.freeze({
    [STORED_KEY]: true as const,
    name,
    schema,
    defaultValue: parsed.data as T,
    storage: options.storage ?? 'local',
    perInstance: options.perInstance ?? false,
    version,
    ...(options.migrate === undefined ? {} : { migrate: options.migrate }),
    ...(owner === undefined ? {} : { owner }),
  })
}

/**
 * Declares one stored value once, in a shared module, so its name, schema, default and area
 * cannot drift apart between the places that use it. The declaring app owns it.
 */
export function storedKey<S extends z.ZodType>(
  name: string,
  schema: WithDefault<S>,
  options?: StoredKeyOptions<z.output<S>>,
): StoredKey<z.output<S>> {
  return declare(undefined, name, schema as z.ZodType<z.output<S>>, options) as StoredKey<
    z.output<S>
  >
}

/** Reads a value another app owns. Writes are refused, so the owner stays its only writer. */
storedKey.from = function from<S extends z.ZodType>(
  owner: string,
  name: string,
  schema: WithDefault<S>,
  options?: StoredKeyOptions<z.output<S>>,
): ReadonlyStoredKey<z.output<S>> {
  return declare(owner, name, schema as z.ZodType<z.output<S>>, options) as ReadonlyStoredKey<
    z.output<S>
  >
}

export function isStoredKey(value: unknown): value is AnyStoredKey<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Partial<StoredKeyFields<unknown>>)[STORED_KEY] === true
  )
}

// ---------------------------------------------------------------------------------------------
// The browser record format the runtime's browser store writes.

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

function storagePrefix(definitionId: string, instanceId?: string): string {
  return instanceId === undefined
    ? `${definitionId}:`
    : `${instanceStoragePrefix(definitionId)}${instanceId.length}:${instanceId}:`
}

/** Length prefixes make arbitrary instance IDs unambiguous without escaping or dependencies. */
function instanceStoragePrefix(definitionId: string): string {
  return `:${definitionId.length}:${definitionId}:`
}

/** `status` is explicit so an invalid or unreadable value cannot masquerade as a missing one. */
export type StorageSnapshot<T> =
  | { readonly status: 'value'; readonly value: T }
  | { readonly status: 'default'; readonly value: T }
  | { readonly status: 'error'; readonly error: Error }

// ---------------------------------------------------------------------------------------------
// The user area: what the shell's adapter exchanges with its backend.

/** One stored value: the schema version it was written with, and the data. */
export interface StoredValue {
  readonly v: number
  readonly d: unknown
}

export interface StoredRow extends StoredValue {
  /**
   * Raised by the server on every save of this key, and never reused after a removal; a row at a
   * revision this tab has already held never replaces what it holds now.
   */
  readonly revision: number
}

/**
 * Everything stored for the signed-in user: owner, then key, then row. A `perInstance` key is
 * stored under `<name>@<instanceId>`.
 */
export type UserStorageState = Readonly<Record<string, Readonly<Record<string, StoredRow>>>>

export interface UserStorageHandle {
  /**
   * Replaces the whole state; takes the same shape `load()` returns. A key missing from it is
   * removed, so never pass a state read before a save this adapter has already resolved (drop a
   * poll that was in flight while a save completed).
   */
  replace(state: UserStorageState): void
}

/**
 * The shell's backend for the `user` area. The framework never polls, opens sockets or syncs
 * tabs by itself: whatever keeps values fresh lives in `sync`. Identity belongs to the server, so
 * nothing here names the user.
 */
export interface UserStorageAdapter {
  /** Called once per signed-in user, before apps mount. */
  load(signal: AbortSignal): Promise<UserStorageState>
  /** One key at a time; `null` removes it. Resolves with the stored row, or `null` once removed. */
  save(
    owner: string,
    key: string,
    value: StoredValue | null,
    signal: AbortSignal,
  ): Promise<StoredRow | null>
  /** Started after a successful load, and aborted when the user changes or the runtime goes. */
  sync?(storage: UserStorageHandle, signal: AbortSignal): void
}
