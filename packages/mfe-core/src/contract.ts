/** Contracts are Zod schemas, so runtime validation and the author-facing types cannot drift. */

import { z } from 'zod'

import {
  createMfeError,
  describeValue,
  formatPath,
  type MfeError,
  type MfeErrorDetails,
} from './errors.ts'

/** A consumer contract never calls `.strict()`, so a Widget can add a field without breaking one. */
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

/** Host control props never forwarded as inputs; `on` + uppercase is reserved separately. */
export const RESERVED_INPUT_NAMES = ['key', 'ref', 'fallback'] as const

const HANDLER_PROP_PATTERN = /^on[A-Z]/
const EVENT_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/

export function isReservedInputName(name: string): boolean {
  return (
    (RESERVED_INPUT_NAMES as readonly string[]).includes(name) || HANDLER_PROP_PATTERN.test(name)
  )
}

export function eventNameToHandlerProp(eventName: string): string {
  return `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`
}

export function isValidEventName(name: string): boolean {
  return EVENT_NAME_PATTERN.test(name)
}

/** An invalid name, or two names that would map to the same `on`-prefixed handler prop. */
export type EventNameProblem =
  | { readonly kind: 'invalid'; readonly name: string }
  | {
      readonly kind: 'collision'
      readonly name: string
      readonly existing: string
      readonly handlerProp: string
    }

/**
 * The first problem in declaration order, so every caller reports the same one; each turns it
 * into its own error, since only the caller knows whether it is reading source or enforcing a
 * definition at creation time.
 */
export function findEventNameProblem(names: readonly string[]): EventNameProblem | null {
  const handlerProps = new Map<string, string>()

  for (const name of names) {
    if (!isValidEventName(name)) return { kind: 'invalid', name }

    const handlerProp = eventNameToHandlerProp(name)
    const existing = handlerProps.get(handlerProp)
    if (existing !== undefined) return { kind: 'collision', name, existing, handlerProp }
    handlerProps.set(handlerProp, name)
  }

  return null
}

/** Built-ins whose instances cannot survive JSON, by the name they report. */
const UNSERIALIZABLE_CLASSES: readonly string[] = ['Date', 'Map', 'Set', 'RegExp', 'Error']

/** Prohibiting what JSON cannot carry keeps iframe or worker isolation available later. */
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
    // An absent optional field is fine, so `undefined` is rejected only where position matters.
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
  if (className !== undefined && UNSERIALIZABLE_CLASSES.includes(className)) {
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
  readonly eventName?: string
}

export type ContractValidation<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: MfeError }

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

/** Zod names the received type, so the concrete value is the one detail a reader cannot re-derive. */
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

/** `z.prettifyError` renders every issue with its path; the `ZodError` itself stays on `cause`. */
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

/** Runs before schema validation, so the diagnostic names the real problem. */
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
