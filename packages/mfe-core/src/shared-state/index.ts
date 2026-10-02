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
export interface SharedStateManifest {
  readonly formatVersion: 1
  readonly contracts: readonly StateContract[]
}
export interface SharedStateRequirements {
  readonly protocolVersion: 1
  readonly contracts: readonly {
    readonly id: string
    readonly revision: string
    readonly capabilities: readonly string[]
  }[]
}
export type StateValues = Record<string, unknown>
export type StateKey<V> = keyof V & string
/** Objects merge recursively; arrays are complete replacements and null is an explicit value. */
export type SharedStateUpdate<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: SharedStateUpdate<T[K]> }
    : T
export type SharedStateSetter<T> = (value: SharedStateUpdate<T>) => Promise<void>
export interface SharedStateStore<V = StateValues> {
  get<K extends StateKey<V>>(key: K): V[K]
  set<K extends StateKey<V>>(key: K, value: SharedStateUpdate<V[K]>): Promise<void>
  subscribe<K extends StateKey<V>>(key: K, listener: () => void): () => void
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
export interface SharedStateAdapter {
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
export interface SharedStateService {
  readonly protocolVersion: 1
  /** Optional read-only diagnostics. Observing never hydrates or binds state. */
  readonly inspection?: SharedStateInspection
  prepare(requirements: SharedStateRequirements, signal?: AbortSignal): Promise<void>
  bind<V = StateValues>(
    requirements: SharedStateRequirements,
    signal?: AbortSignal,
  ): SharedStateStore<V>
}
export type SharedStateStatus = 'absent' | 'hydrating' | 'ready' | 'invalid' | 'persistence-failed'
export interface SharedStateInspectionEntry {
  readonly contract: StateContract
  readonly status: SharedStateStatus
  readonly recordRevision: number
  readonly pendingWrites: number
  readonly confirmed: Json | undefined
  readonly effective: Json | undefined
  readonly error: string | undefined
}
export interface SharedStateInspectionSnapshot {
  /** Changes on a scope switch; deliberately does not expose the authenticated scope. */
  readonly generation: number
  readonly disposed: boolean
  readonly entries: readonly SharedStateInspectionEntry[]
}
export interface SharedStateInspection {
  getSnapshot(): SharedStateInspectionSnapshot
  subscribe(listener: () => void): () => void
}
export interface SharedStateScopeService extends SharedStateService {
  setScope(scope: string): void
  dispose(): void
}
export type SharedStateErrorCode =
  | 'invalid-value'
  | 'unsupported-contract'
  | 'not-ready'
  | 'scope-disposed'
  | 'conflict'
  | 'persistence-failed'
export class SharedStateError extends Error {
  readonly code: `shared-state/${SharedStateErrorCode}`
  constructor(
    code: SharedStateErrorCode,
    readonly id: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${id}: ${message}`, options)
    this.name = 'SharedStateError'
    this.code = `shared-state/${code}`
  }
}
export const EMPTY_SHARED_STATE: SharedStateRequirements = { protocolVersion: 1, contracts: [] }

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
    throw new SharedStateError('invalid-value', id, `${path || '<root>'} must be finite JSON data`)
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
    throw new SharedStateError('invalid-value', id, `${path || '<root>'}: expected ${expected}`)
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
    throw new SharedStateError('invalid-value', schema.id, 'A state record cannot be undefined')
  return result
}
