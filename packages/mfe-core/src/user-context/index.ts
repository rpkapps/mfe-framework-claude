import type { z } from 'zod'

import type { MfeError, MfeResult } from '../errors.ts'

/** Structural, JSON-only transport. This entry imports Zod types only, never Zod itself. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** What a definition, or the shell, declares: its own slice and the foreign subsets it reads. */
export interface UserContextDeclaration {
  readonly schema?: z.ZodObject
  readonly reads?: Readonly<Record<string, z.ZodObject>>
}
/** A definition as user context sees it; the mount path has already asserted its identity. */
export interface UserContextOwner {
  readonly id: string
  readonly userContext?: UserContextDeclaration | undefined
}
/** The owned slice a declaration's schema parses to, for generated bindings. */
export type UserContextValuesOf<D> = D extends { readonly schema: infer S extends z.ZodType }
  ? z.output<S>
  : Record<string, never>
/** Each declared foreign owner's subset, as its read schema parses it. */
export type UserContextReadsOf<D> = D extends {
  readonly reads: infer R extends Readonly<Record<string, z.ZodType>>
}
  ? { readonly [K in keyof R]: z.output<R[K]> }
  : Record<never, never>

export type StateValues = Record<string, unknown>
export type StateKey<V> = keyof V & string
/** Objects merge recursively; arrays are complete replacements and null is an explicit value. */
export type UserContextUpdate<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: UserContextUpdate<T[K]> }
    : T
export type UserContextResult<T> = MfeResult<T>
export type UserContextSetter<T> = (value: UserContextUpdate<T>) => Promise<UserContextResult<T>>
export interface UserContextReader<V = StateValues> {
  getSnapshot(): Readonly<V>
  get<K extends StateKey<V>>(key: K): V[K]
  subscribe<K extends StateKey<V>>(key: K, listener: () => void): () => void
  /** Observe accepted changes anywhere in this owner slice. */
  observe(listener: () => void): () => void
}
export interface UserContextStore<V = StateValues> extends UserContextReader<V> {
  set<K extends StateKey<V>>(
    key: K,
    value: UserContextUpdate<V[K]>,
  ): Promise<UserContextResult<V[K]>>
}
export interface StateRecord {
  readonly id: string
  /** Increases with every accepted write for one user and owner. Zero denotes absent. */
  readonly revision: number
  readonly value?: Json
}
/** One key of one owner. The server merges it into the stored record and bumps its revision. */
export interface StateWrite {
  readonly id: string
  readonly value: { readonly [key: string]: Json }
}
/**
 * The shell's persistence transport for the signed-in user. The server derives the user from the
 * authenticated request; the runtime resets itself and aborts old requests when the user changes.
 */
export interface UserContextAdapter {
  hydrate(ids: readonly string[], signal: AbortSignal): Promise<readonly StateRecord[]>
  /** Resolves after the server stored the merged record, with that record and its revision. */
  write(write: StateWrite, signal: AbortSignal): Promise<StateRecord>
  /** Full records from other tabs or devices; a record older than the one held is ignored. */
  subscribe?(listener: (record: StateRecord) => void, signal: AbortSignal): () => void
}
export interface UserContextService {
  /** Read-only diagnostics. Observing never hydrates or binds state. */
  readonly inspection: UserContextInspection
  /** The shell's own declaration, bound by its generated host binding and theme. */
  readonly host?: UserContextOwner | undefined
  prepare(owner: UserContextOwner, signal?: AbortSignal): Promise<void>
  bind<V = StateValues>(owner: UserContextOwner, signal?: AbortSignal): UserContextStore<V>
  bindReadOnly<V = StateValues>(
    owner: UserContextOwner,
    ownerId: string,
    signal?: AbortSignal,
  ): UserContextReader<V>
}
export type UserContextStatus = 'hydrating' | 'ready' | 'invalid'
export interface UserContextInspectionEntry {
  readonly id: string
  readonly status: UserContextStatus
  readonly revision: number
  /** The stored record as the server returned it, before any schema applied defaults. */
  readonly value: Json | undefined
  /** The owner's schema as JSON Schema, when a definition on this page declared it. */
  readonly schema: Json | undefined
  readonly error: string | undefined
}
export interface UserContextInspectionSnapshot {
  /** Changes when the user changes; deliberately does not expose who the user is. */
  readonly generation: number
  readonly disposed: boolean
  readonly entries: readonly UserContextInspectionEntry[]
}
export interface UserContextInspection {
  getSnapshot(): UserContextInspectionSnapshot
  subscribe(listener: () => void): () => void
}
export const USER_CONTEXT_ERROR_CODES = [
  'unauthorized-owner',
  'invalid-value',
  'undeclared',
  'not-ready',
  'scope-disposed',
  'persistence-failed',
] as const
export type UserContextErrorCode = (typeof USER_CONTEXT_ERROR_CODES)[number]
export class UserContextError extends Error implements MfeError {
  readonly operation = 'user-context'
  readonly code: `user-context/${UserContextErrorCode}`
  constructor(
    code: UserContextErrorCode,
    readonly id: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${id}: ${message}`, options)
    this.name = 'UserContextError'
    this.code = `user-context/${code}`
  }
}
Object.defineProperty(UserContextError.prototype, Symbol.for('@company/mfe.error'), { value: true })

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}
export function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
/** Reject JSON's lossy cases before validation, including cycles and non-finite numbers. */
export function assertJson(
  value: unknown,
  id = '<value>',
  path = '',
  seen = new Set<object>(),
): asserts value is Json {
  const invalid = (): never => {
    throw new UserContextError('invalid-value', id, `${path || '<root>'} must be finite JSON data`)
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid()
    return
  }
  if ((!Array.isArray(value) && !isObject(value)) || seen.has(value as object)) invalid()
  seen.add(value as object)
  for (const [key, child] of Object.entries(value as object))
    assertJson(child, id, `${path}.${key}`, seen)
  if (Array.isArray(value) && Object.keys(value).length !== value.length) invalid()
  if (Object.getOwnPropertySymbols(value).length > 0) invalid()
  seen.delete(value as object)
}
export function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child)
    Object.freeze(value)
  }
  return value
}
/** Omitted object properties are always preserved. Arrays, scalars and null replace explicitly. */
export function mergeStateValue(current: unknown, supplied: Json): Json {
  if (!isObject(supplied)) return structuredClone(supplied)
  const output: Record<string, Json> = isObject(current)
    ? (structuredClone(current) as Record<string, Json>)
    : {}
  for (const [key, value] of Object.entries(supplied)) {
    const next = mergeStateValue(Object.hasOwn(output, key) ? output[key] : undefined, value)
    Object.defineProperty(output, key, {
      value: next,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return output
}

export {
  createUserContextSelection,
  createUserContextSelector,
  type UserContextSelection,
} from './selection.ts'
