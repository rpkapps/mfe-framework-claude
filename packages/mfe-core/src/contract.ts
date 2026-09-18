/**
 * Widget contract primitives and two-sided validation. Schemas are the source
 * of truth for validation and author-facing types alike. This module is typed
 * against Zod but never imports it: it calls `safeParse` on the author's own
 * schema, so one Zod instance stays in play and the core keeps no runtime dep.
 */

import { createMfeErrorFactory, describeValue, type MfeError } from './errors.ts'

/**
 * The slice of Zod's surface the framework uses. Typing against this rather
 * than `z.ZodType` means a container's Zod copy and the framework's
 * declarations never have to be the same instance of the type.
 */
export interface ContractSchema<T> {
  safeParse(value: unknown): ContractParseResult<T>
}

export type ContractParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: ContractParseError }

export interface ContractParseError {
  readonly issues: readonly ContractIssue[]
}

export interface ContractIssue {
  readonly path: readonly (string | number | symbol)[]
  readonly message: string
  readonly code?: string
  /** Present on Zod's `invalid_type` issues; used to phrase "expected …". */
  readonly expected?: string
}

export type InferContract<S> = S extends ContractSchema<infer T> ? T : never

/**
 * A Widget's declared contract. `events` maps a lower-camel-case event name to
 * the schema for its payload; the consumer sees it as `on` + capitalized name.
 */
export interface WidgetContract<
  Inputs extends ContractSchema<unknown> = ContractSchema<unknown>,
  Events extends Record<string, ContractSchema<unknown>> = Record<string, ContractSchema<unknown>>,
> {
  readonly inputs: Inputs
  readonly events: Events
}

export type ContractInputs<C extends WidgetContract> = InferContract<C['inputs']>

export type ContractEvents<C extends WidgetContract> = {
  readonly [K in keyof C['events']]: InferContract<C['events'][K]>
}

/**
 * Host control props that are never forwarded as Widget inputs.
 * `on` + uppercase is reserved separately because those are event handlers.
 */
export const RESERVED_INPUT_NAMES = ['key', 'ref', 'fallback'] as const

const HANDLER_PROP_PATTERN = /^on[A-Z]/
const EVENT_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/

export function isReservedInputName(name: string): boolean {
  return (
    (RESERVED_INPUT_NAMES as readonly string[]).includes(name) || HANDLER_PROP_PATTERN.test(name)
  )
}

/** Maps a contract event name to its consumer-facing handler prop. */
export function eventNameToHandlerProp(eventName: string): string {
  return `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`
}

export function isValidEventName(name: string): boolean {
  return EVENT_NAME_PATTERN.test(name)
}

/**
 * Inputs and event payloads must be JSON-serializable: prohibiting functions,
 * class instances, DOM nodes, elements, `Date`, `Map` and `Set` keeps iframe or
 * worker isolation available later, and validation cannot check them anyway.
 *
 * Returns the first offending value's path, or `null`. Cycles are reported
 * rather than followed.
 */
export function findNonSerializableValue(
  value: unknown,
  path: readonly (string | number)[] = [],
  seen = new Set<object>(),
): { readonly path: readonly (string | number)[]; readonly description: string } | null {
  if (value === null) return null

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null
    case 'number':
      return Number.isFinite(value)
        ? null
        : { path, description: `${String(value)} (not representable in JSON)` }
    case 'undefined':
      // `undefined` disappears through JSON; an explicitly absent optional field
      // is fine, so it is only rejected inside an array where position matters.
      return typeof path[path.length - 1] === 'number'
        ? { path, description: 'undefined inside an array' }
        : null
    case 'bigint':
      return { path, description: 'a bigint' }
    case 'function':
      return {
        path,
        description: 'a function. A consumer that needs a callback subscribes to an event instead',
      }
    case 'symbol':
      return { path, description: 'a symbol' }
    default:
      break
  }

  const object = value
  if (seen.has(object)) return { path, description: 'a circular reference' }

  if (object instanceof Date) return { path, description: 'a Date' }
  if (object instanceof Map) return { path, description: 'a Map' }
  if (object instanceof Set) return { path, description: 'a Set' }
  if (object instanceof RegExp) return { path, description: 'a RegExp' }
  if (object instanceof Error) return { path, description: 'an Error' }
  if (typeof Node !== 'undefined' && object instanceof Node) {
    return { path, description: 'a DOM node' }
  }
  // React elements are plain objects, so they need their own marker check.
  if (
    Object.hasOwn(object, '$$typeof') &&
    typeof (object as { $$typeof: unknown }).$$typeof === 'symbol'
  ) {
    return { path, description: 'a React element' }
  }

  seen.add(object)
  try {
    if (Array.isArray(object)) {
      for (let index = 0; index < object.length; index += 1) {
        const found = findNonSerializableValue(object[index], [...path, index], seen)
        if (found) return found
      }
      return null
    }

    const prototype = Object.getPrototypeOf(object) as object | null
    if (prototype !== null && prototype !== Object.prototype) {
      const name = (object as { constructor?: { name?: string } }).constructor?.name
      return { path, description: `a ${name ?? 'class'} instance` }
    }

    for (const [key, entry] of Object.entries(object)) {
      const found = findNonSerializableValue(entry, [...path, key], seen)
      if (found) return found
    }
    return null
  } finally {
    seen.delete(object)
  }
}

export interface ContractValidationContext {
  readonly id: string
  readonly definitionVersion?: string
  readonly direction: 'input' | 'event'
  /** `'provider'` validates its own declaration; `'consumer'` what it subscribed to. */
  readonly side: 'provider' | 'consumer'
  /** Event name, when validating an event payload. */
  readonly eventName?: string
  /** Appended to the message, e.g. "The previous valid inputs remain displayed." */
  readonly note?: string
}

export type ContractValidation<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: MfeError }

/** Fixes everything the context alone decides, so each failure adds only its own clauses. */
function contractFailure(context: ContractValidationContext) {
  return createMfeErrorFactory({
    code: context.direction === 'input' ? 'contract/input-mismatch' : 'contract/event-mismatch',
    id: context.id,
    ...(context.definitionVersion === undefined
      ? {}
      : { definitionVersion: context.definitionVersion }),
    operation:
      context.direction === 'input'
        ? 'accept input'
        : `emit event '${context.eventName ?? 'unknown'}'`,
    direction: context.direction,
  })
}

function declaredBy(context: ContractValidationContext): string {
  if (context.side === 'consumer')
    return 'The consuming component, through the runtime contract it supplied'
  return context.direction === 'input'
    ? 'The Widget provider'
    : 'The Widget provider, at its emit call'
}

function repairFor(context: ContractValidationContext, field: string): string {
  if (context.direction === 'input') {
    return context.side === 'provider'
      ? `Check the ${field || 'input'} prop in the consuming component.`
      : `Check the ${field || 'input'} value passed to the Widget.`
  }
  const event = context.eventName ?? 'event'
  return context.side === 'provider'
    ? `Check the payload passed to emit('${event}', …).`
    : `Check the '${event}' schema in the contract this consumer declared, or upgrade the contract package.`
}

/**
 * Validates a value against a contract schema, turning a failure into a
 * structured error that names the field, the expectation and the repair.
 *
 * The first issue drives the message: reporting every issue at once buries the
 * actionable one. The underlying parse error stays on `cause`.
 */
export function validateAgainstContract<T>(
  schema: ContractSchema<T>,
  value: unknown,
  context: ContractValidationContext,
): ContractValidation<T> {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, value: result.data }

  const issue = result.error.issues[0]
  const path = (issue?.path ?? []).filter(
    (segment): segment is string | number => typeof segment !== 'symbol',
  )

  return {
    ok: false,
    error: contractFailure(context)({
      ...(path.length > 0 ? { path } : {}),
      expected: issue?.expected ?? issue?.message ?? 'a value matching the declared schema',
      observed: describeValue(readPath(value, path)),
      declaredBy: declaredBy(context),
      repair: repairFor(context, path.join('.')),
      ...(context.note === undefined ? {} : { note: context.note }),
      cause: result.error,
    }),
  }
}

/** Reads the value an issue path points at, for the "received …" clause. */
function readPath(root: unknown, path: readonly (string | number)[]): unknown {
  let current = root
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

/**
 * Rejects non-serializable values before schema validation, so the diagnostic
 * names the real problem instead of a downstream type error.
 */
export function validateSerializable(
  value: unknown,
  context: ContractValidationContext,
): MfeError | null {
  const offender = findNonSerializableValue(value)
  if (!offender) return null

  return contractFailure(context)({
    ...(offender.path.length > 0 ? { path: offender.path } : {}),
    expected: 'a JSON-serializable value',
    observed: offender.description,
    declaredBy: 'The framework contract boundary',
    repair:
      'Replace it with plain JSON data (strings, numbers, booleans, null, arrays and plain objects). Functions, class instances, DOM nodes, React elements, Date, Map and Set cannot cross the boundary.',
  })
}
