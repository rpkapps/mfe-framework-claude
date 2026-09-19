/**
 * Widget contract primitives and two-sided validation. Contracts are Zod
 * schemas, which are the source of truth for runtime validation and for the
 * author-facing types alike, so there is no parallel type parameter to keep in
 * sync and no framework-owned mirror of Zod's surface.
 */

import { z } from 'zod'

import {
  createMfeError,
  describeValue,
  formatPath,
  type MfeError,
  type MfeErrorDetails,
} from './errors.ts'

/**
 * A Widget's declared contract. `events` maps a lower-camel-case event name to
 * the schema for its payload; the consumer sees it as `on` + capitalized name.
 *
 * A consumer contract never calls `.strict()`: Zod's default strip-unknown-keys
 * behaviour is what lets a Widget add a field without breaking its consumers.
 */
export interface WidgetContract<
  Inputs extends z.ZodType = z.ZodType,
  Events extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> {
  readonly inputs: Inputs
  readonly events: Events
}

export type ContractInputs<C extends WidgetContract> = z.infer<C['inputs']>

export type ContractEvents<C extends WidgetContract> = {
  readonly [K in keyof C['events']]: z.infer<C['events'][K]>
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

/** Built-ins whose instances cannot survive JSON, by the name they report. */
const UNSERIALIZABLE_CLASSES = new Set(['Date', 'Map', 'Set', 'RegExp', 'Error'])

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

  const type = typeof value
  if (type === 'string' || type === 'boolean') return null

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? null
      : { path, description: `${String(value)} (not representable in JSON)` }
  }

  if (type === 'undefined') {
    // `undefined` disappears through JSON; an explicitly absent optional field
    // is fine, so it is only rejected inside an array where position matters.
    return typeof path[path.length - 1] === 'number'
      ? { path, description: 'undefined inside an array' }
      : null
  }

  if (type !== 'object') {
    return {
      path,
      description:
        type === 'function'
          ? 'a function. A consumer that needs a callback subscribes to an event instead'
          : `a ${type}`,
    }
  }

  const object = value as object
  if (seen.has(object)) return { path, description: 'a circular reference' }

  const className = object.constructor?.name
  if (className !== undefined && UNSERIALIZABLE_CLASSES.has(className)) {
    return { path, description: `a ${className}` }
  }
  if (typeof Node !== 'undefined' && object instanceof Node) {
    return { path, description: 'a DOM node' }
  }
  // React elements are plain objects, so they need their own marker check.
  if (typeof (object as { $$typeof?: unknown }).$$typeof === 'symbol') {
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
      return { path, description: `a ${className ?? 'class'} instance` }
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
}

export type ContractValidation<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: MfeError }

/** The identity every contract failure carries, decided by the context alone. */
function failureBase(
  context: ContractValidationContext,
): Pick<MfeErrorDetails, 'code' | 'id' | 'operation' | 'direction' | 'definitionVersion'> {
  const isInput = context.direction === 'input'
  return {
    code: isInput ? 'contract/input-mismatch' : 'contract/event-mismatch',
    id: context.id,
    ...(context.definitionVersion === undefined
      ? {}
      : { definitionVersion: context.definitionVersion }),
    operation: isInput ? 'accept input' : `emit event '${context.eventName ?? 'unknown'}'`,
    direction: context.direction,
  }
}

function repairFor(context: ContractValidationContext, field: string): string {
  if (context.direction === 'input') return `Check the ${field || 'input'} prop on the Widget.`
  const event = context.eventName ?? 'event'
  return context.side === 'provider'
    ? `Check the payload passed to emit('${event}', …).`
    : `Check the '${event}' schema this consumer declared.`
}

/**
 * Zod names the received *type* ("received number"); the concrete value is the
 * one detail the reader cannot re-derive from the message. Resolve it at the
 * failing path so a nested field reports its own value rather than the whole
 * object, and fall back to zod alone when the path leads nowhere nameable.
 */
function describeObserved(
  value: unknown,
  path: readonly (string | number)[],
  error: z.ZodError,
): string {
  const rendered = z.prettifyError(error)
  const observed = path.reduce<unknown>(
    (current, segment) =>
      current !== null && typeof current === 'object'
        ? (current as Record<string | number, unknown>)[segment]
        : undefined,
    value,
  )
  if (observed !== null && typeof observed === 'object') return rendered
  return `${describeValue(observed)}; ${rendered}`
}

/**
 * Validates a value against a contract schema, turning a failure into a
 * structured error that names the field, the expectation and the repair.
 *
 * `z.prettifyError` renders every issue with its own path, which beats anything
 * re-derived here; the first issue's path fills the structured `path` field,
 * and the `ZodError` itself stays on `cause`.
 */
export function validateAgainstContract<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context: ContractValidationContext,
): ContractValidation<T> {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, value: result.data }

  const path = (result.error.issues[0]?.path ?? []).filter(
    (segment): segment is string | number => typeof segment !== 'symbol',
  )

  return {
    ok: false,
    error: createMfeError({
      ...failureBase(context),
      ...(path.length > 0 ? { path } : {}),
      observed: describeObserved(value, path, result.error),
      repair: repairFor(context, formatPath(path)),
      cause: result.error,
    }),
  }
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

  return createMfeError({
    ...failureBase(context),
    ...(offender.path.length > 0 ? { path: offender.path } : {}),
    expected: 'a JSON-serializable value',
    observed: offender.description,
    repair: 'Only JSON data crosses the boundary: no functions, class instances or DOM nodes.',
  })
}
