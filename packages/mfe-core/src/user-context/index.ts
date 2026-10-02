import type { MfeError, MfeResult } from '../errors.ts'
import { isValidDefinitionId } from '../definition.ts'

/** Structural, JSON-only ABI. This entry has no Zod, React or compiler dependencies. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type StateNode =
  | { readonly kind: 'string'; readonly min?: number; readonly max?: number }
  | {
      readonly kind: 'number'
      readonly min?: number
      readonly max?: number
      readonly integer?: true
    }
  | { readonly kind: 'boolean' | 'null' }
  | { readonly kind: 'literal'; readonly value: Json }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | {
      readonly kind: 'array'
      readonly item: StateNode
      readonly min?: number
      readonly max?: number
    }
  | {
      readonly kind: 'object'
      readonly fields: Readonly<Record<string, StateNode>>
      readonly strict: boolean
    }
  | { readonly kind: 'nullable' | 'optional'; readonly inner: StateNode }
  | { readonly kind: 'default'; readonly inner: StateNode; readonly value: Json }

export interface StateContract {
  readonly formatVersion: 1
  readonly id: string
  readonly revision: string
  readonly node: StateNode
}
export interface UserContextManifest {
  readonly formatVersion: 1
  readonly contracts: readonly StateContract[]
}
export interface UserContextRequirements {
  readonly protocolVersion: 1
  /** Definition identity asserted separately by the trusted mount path. */
  readonly ownerId: string
  readonly contracts: readonly {
    readonly id: string
    readonly revision: string
    readonly capabilities: readonly string[]
  }[]
}
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
  /** Observe committed changes anywhere in this owner slice. */
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
  /** Monotonic within one scope/key, never a contract fingerprint. Zero denotes absent. */
  readonly revision: number
  readonly value?: Json
}
export interface StateWrite {
  readonly scope: string
  readonly id: string
  readonly expectedRevision: number
  readonly operationId: string
  readonly value: Json
}
export interface UserContextAdapter {
  hydrate(
    scope: string,
    ids: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly StateRecord[]>
  /** Must resolve only after durable acceptance, returning a fully validated canonical record. */
  write(operation: StateWrite, signal: AbortSignal): Promise<StateRecord>
  /** Full authoritative records; delayed/duplicate events are ignored by record revision. */
  subscribe?(
    scope: string,
    listener: (record: StateRecord) => void,
    signal: AbortSignal,
  ): () => void
}
export interface UserContextService {
  readonly protocolVersion: 1
  /** Optional read-only diagnostics. Observing never hydrates or binds state. */
  readonly inspection?: UserContextInspection
  prepare(requirements: UserContextRequirements, signal?: AbortSignal): Promise<void>
  bind<V = StateValues>(
    definitionId: string,
    requirements: UserContextRequirements,
    signal?: AbortSignal,
  ): UserContextStore<V>
  bindReadOnly<V = StateValues>(
    definitionId: string,
    requirements: UserContextRequirements,
    ownerId: string,
    signal?: AbortSignal,
  ): UserContextReader<V>
}
export type UserContextStatus = 'absent' | 'hydrating' | 'ready' | 'invalid' | 'persistence-failed'
export interface UserContextInspectionEntry {
  readonly contract: StateContract
  readonly status: UserContextStatus
  readonly recordRevision: number
  readonly pendingWrites: number
  readonly confirmed: Json | undefined
  readonly effective: Json | undefined
  readonly error: string | undefined
}
export interface UserContextInspectionSnapshot {
  /** Changes on a scope switch; deliberately does not expose the authenticated scope. */
  readonly generation: number
  readonly disposed: boolean
  readonly entries: readonly UserContextInspectionEntry[]
}
export interface UserContextInspection {
  getSnapshot(): UserContextInspectionSnapshot
  subscribe(listener: () => void): () => void
}
export interface UserContextScopeService extends UserContextService {
  setScope(scope: string): void
  dispose(): void
}
export type UserContextErrorCode =
  | 'unauthorized-owner'
  | 'invalid-value'
  | 'unsupported-contract'
  | 'not-ready'
  | 'scope-disposed'
  | 'conflict'
  | 'persistence-failed'
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

export function emptyUserContextRequirements(ownerId: string): UserContextRequirements {
  return { protocolVersion: 1, ownerId, contracts: [] }
}

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
/** Required schema features. Object additions add tokens without invalidating older consumers. */
export function stateCapabilities(node: StateNode): readonly string[] {
  const tokens: string[] = []
  const visit = (value: StateNode, path: string): void => {
    if (value.kind === 'object') {
      tokens.push(`${path}:${stableJson({ kind: value.kind, strict: value.strict })}`)
      for (const [key, field] of Object.entries(value.fields))
        visit(field, `${path}/f:${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)
    } else if ('inner' in value) {
      tokens.push(
        `${path}:${stableJson(value.kind === 'default' ? { kind: value.kind, value: value.value } : { kind: value.kind })}`,
      )
      visit(value.inner, `${path}/i`)
    } else tokens.push(`${path}:${stableJson(value)}`)
  }
  visit(node, '')
  return tokens.sort()
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

/** Materialize a caller's view or write. Projection happens BEFORE a strict object's validation. */
export function normalize(
  node: StateNode,
  value: unknown,
  id: string,
  project = false,
  path = '',
): Json | undefined {
  const fail = (expected: string): never => {
    throw new UserContextError('invalid-value', id, `${path || '<root>'}: expected ${expected}`)
  }
  switch (node.kind) {
    case 'default':
      return value === undefined
        ? structuredClone(node.value)
        : normalize(node.inner, value, id, project, path)
    case 'optional':
      return value === undefined ? undefined : normalize(node.inner, value, id, project, path)
    case 'nullable':
      return value === null ? null : normalize(node.inner, value, id, project, path)
    case 'null':
      return value === null ? null : fail('null')
    case 'boolean':
      return typeof value === 'boolean' ? value : fail('boolean')
    case 'string':
      if (
        typeof value !== 'string' ||
        (node.min !== undefined && value.length < node.min) ||
        (node.max !== undefined && value.length > node.max)
      )
        fail('string within the declared length bounds')
      return value as string
    case 'number':
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (node.integer && !Number.isSafeInteger(value)) ||
        (node.min !== undefined && value < node.min) ||
        (node.max !== undefined && value > node.max)
      )
        fail('finite number within the declared bounds')
      return value as number
    case 'literal':
      return stableJson(value) === stableJson(node.value)
        ? structuredClone(node.value)
        : fail(JSON.stringify(node.value))
    case 'enum':
      return typeof value === 'string' && node.values.includes(value)
        ? value
        : fail(node.values.join(' | '))
    case 'array':
      if (
        !Array.isArray(value) ||
        (node.min !== undefined && value.length < node.min) ||
        (node.max !== undefined && value.length > node.max)
      )
        return fail('array within the declared length bounds')
      // Arrays are atomic; projection must never silently strip an unknown item field.
      return value.map((item, index) => {
        const normalized = normalize(node.item, item, id, false, `${path}[${index}]`)
        if (normalized === undefined) fail('defined array item')
        return normalized as Json
      })
    case 'object': {
      if (value === undefined && path === '') value = {}
      if (!isObject(value)) return fail('fixed-shape object')
      if (
        !project &&
        node.strict &&
        Object.keys(value).some(key => !Object.hasOwn(node.fields, key))
      )
        fail('no undeclared properties')
      const output: Record<string, Json> = {}
      for (const [key, field] of Object.entries(node.fields)) {
        const child = normalize(
          field,
          Object.hasOwn(value, key) ? value[key] : undefined,
          id,
          project,
          path ? `${path}.${key}` : key,
        )
        if (child !== undefined)
          Object.defineProperty(output, key, {
            value: child,
            enumerable: true,
            configurable: true,
            writable: true,
          })
      }
      return output
    }
  }
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
export function applyStateWrite(schema: StateContract, current: unknown, value: unknown): Json {
  assertJson(value, schema.id)
  const result = normalize(schema.node, mergeStateValue(current, value), schema.id)
  if (result === undefined)
    throw new UserContextError('invalid-value', schema.id, 'A state record cannot be undefined')
  return result
}

/** Validate untrusted compiled contracts before traversing their schema or accepting data. */
export function assertStateContract(value: unknown): asserts value is StateContract {
  const fail = (): never => {
    throw new UserContextError(
      'unsupported-contract',
      '<contract>',
      'Malformed owner contract; rebuild its user-context manifest',
    )
  }
  if (
    !isObject(value) ||
    value['formatVersion'] !== 1 ||
    !isValidDefinitionId(value['id']) ||
    typeof value['revision'] !== 'string' ||
    !value['revision']
  )
    fail()
  const visit = (node: unknown, ancestors: Set<unknown>): void => {
    if (!isObject(node) || ancestors.has(node)) fail()
    const record = node as Record<string, unknown>
    ancestors.add(node)
    const allowed: Readonly<Record<string, readonly string[]>> = {
      string: ['kind', 'min', 'max'],
      number: ['kind', 'min', 'max', 'integer'],
      boolean: ['kind'],
      null: ['kind'],
      literal: ['kind', 'value'],
      enum: ['kind', 'values'],
      array: ['kind', 'item', 'min', 'max'],
      object: ['kind', 'fields', 'strict'],
      optional: ['kind', 'inner'],
      nullable: ['kind', 'inner'],
      default: ['kind', 'inner', 'value'],
    }
    const keys = typeof record['kind'] === 'string' ? allowed[record['kind']] : undefined
    if (!keys || Object.keys(record).some(key => !keys.includes(key))) fail()
    const bound = (name: string): void => {
      if (
        record[name] !== undefined &&
        (typeof record[name] !== 'number' || !Number.isFinite(record[name]))
      )
        fail()
    }
    switch (record['kind']) {
      case 'string':
      case 'number':
        bound('min')
        bound('max')
        if (record['integer'] !== undefined && record['integer'] !== true) fail()
        break
      case 'boolean':
      case 'null':
        break
      case 'literal':
        assertJson(record['value'])
        break
      case 'enum':
        if (
          !Array.isArray(record['values']) ||
          !record['values'].length ||
          record['values'].some(item => typeof item !== 'string')
        )
          fail()
        break
      case 'array':
        bound('min')
        bound('max')
        visit(record['item'], ancestors)
        break
      case 'object':
        if (!isObject(record['fields']) || typeof record['strict'] !== 'boolean') fail()
        for (const field of Object.values(record['fields'] as Record<string, unknown>))
          visit(field, ancestors)
        break
      case 'default':
        assertJson(record['value'])
        visit(record['inner'], ancestors)
        normalize(record['inner'] as StateNode, record['value'], '<default>')
        break
      case 'optional':
      case 'nullable':
        visit(record['inner'], ancestors)
        break
      default:
        fail()
    }
    ancestors.delete(node)
  }
  const contract = value as StateContract
  visit(contract.node, new Set())
  let root = contract.node
  while (root.kind === 'default') root = root.inner
  if (root.kind !== 'object') fail()
}
