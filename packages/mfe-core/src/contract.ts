/** Contracts are Zod schemas, so runtime validation and the author-facing types cannot drift. */

import { z } from 'zod'

import {
  createMfeError,
  describeValue,
  formatPath,
  type MfeError,
  type MfeErrorDetails,
} from './errors.ts'

/** The schemas of a Widget's outputs, one property per output, each that output's payload. */
export type OutputSchema = z.ZodObject<Readonly<Record<string, z.ZodType>>>

/**
 * The same two fields an action and a tool have. `inputSchema` is the values going in; the
 * `outputSchema` of a Widget has a property per named output, each emitted any number of times, or
 * never, while it is mounted, so whether a property is required means nothing and no reader looks.
 * A consumer contract never calls `.strict()`, so a Widget can add a field without breaking one.
 */
export interface WidgetContract<
  Inputs extends z.ZodType = z.ZodType,
  Outputs extends OutputSchema = OutputSchema,
> {
  readonly inputSchema: Inputs
  readonly outputSchema: Outputs
}

/*
 * Each side of the boundary writes a value before its schema parses it and reads one after, and
 * the two differ wherever a schema has a `.default()` or a `.transform()`. So the consumer's view
 * of a contract, `ContractInputs` and `ContractOutputs`, and the Widget's, `ContractParsedInputs`
 * and `ContractEmitPayloads`, are separate types.
 */

/** What a consumer passes: the input schema's input, so a field with a default may be left out. */
export type ContractInputs<C extends WidgetContract> = z.input<C['inputSchema']>

/** What the Widget renders from: the inputs as the schema parsed them. */
export type ContractParsedInputs<C extends WidgetContract> = z.output<C['inputSchema']>

/** What a consumer's handler receives for each output: the payload as its schema parsed it. */
export type ContractOutputs<C extends WidgetContract> = {
  readonly [K in keyof C['outputSchema']['shape']]: z.output<C['outputSchema']['shape'][K]>
}

/** What the Widget passes to `emit` for each output, before the payload's schema parses it. */
export type ContractEmitPayloads<C extends WidgetContract> = {
  readonly [K in keyof C['outputSchema']['shape']]: z.input<C['outputSchema']['shape'][K]>
}

/** The payload schema of one output, or `undefined` when the contract declares no such output. */
export function outputPayloadSchema(
  outputSchema: OutputSchema | undefined,
  name: string,
): z.ZodType | undefined {
  const shape: Readonly<Record<string, z.ZodType>> | undefined = outputSchema?.shape
  return shape !== undefined && Object.hasOwn(shape, name) ? shape[name] : undefined
}

/**
 * Host control props never forwarded as inputs; `on` + uppercase is reserved separately. A host
 * places a Widget by id without its contract, so it can only tell its own props from inputs by
 * name, and an input with one of these names would never reach the Widget.
 */
export const RESERVED_INPUT_NAMES = ['key', 'ref', 'fallback', 'pending'] as const

const HANDLER_PROP_PATTERN = /^on[A-Z]/
const OUTPUT_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/

export function isReservedInputName(name: string): boolean {
  return (
    (RESERVED_INPUT_NAMES as readonly string[]).includes(name) || HANDLER_PROP_PATTERN.test(name)
  )
}

export function outputNameToHandlerProp(outputName: string): string {
  return `on${outputName.charAt(0).toUpperCase()}${outputName.slice(1)}`
}

export function isValidOutputName(name: string): boolean {
  return OUTPUT_NAME_PATTERN.test(name)
}

/** An invalid name, or two names that would map to the same `on`-prefixed handler prop. */
export type OutputNameProblem =
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
export function findOutputNameProblem(names: readonly string[]): OutputNameProblem | null {
  const handlerProps = new Map<string, string>()

  for (const name of names) {
    if (!isValidOutputName(name)) return { kind: 'invalid', name }

    const handlerProp = outputNameToHandlerProp(name)
    const existing = handlerProps.get(handlerProp)
    if (existing !== undefined) return { kind: 'collision', name, existing, handlerProp }
    handlerProps.set(handlerProp, name)
  }

  return null
}

/**
 * Why `createWidget` cannot accept an `outputSchema`: it is not an object schema, or one of its
 * names is not lower camel case or maps to the same handler prop as another. Each adapter throws
 * it, naming in `renameRepair` how its consumers see an output.
 */
export function outputSchemaError(
  id: string,
  outputSchema: OutputSchema | undefined,
  renameRepair: string,
): MfeError | undefined {
  const shape: unknown = (outputSchema as Partial<OutputSchema> | undefined)?.shape
  if (shape === null || typeof shape !== 'object') {
    return createMfeError({
      code: 'contract/output-mismatch',
      id,
      operation: 'declare the outputs',
      expected: 'an outputSchema made with z.object, one property per output',
      observed: outputSchema === undefined ? 'nothing' : 'a schema that is not an object schema',
      repair:
        'Declare outputSchema: z.object({ acknowledged: z.object({ … }) }), or z.object({}) when the Widget emits nothing.',
    })
  }

  const problem = findOutputNameProblem(Object.keys(shape))
  if (problem === null) return undefined

  const declaration = {
    code: 'contract/output-mismatch',
    id,
    operation: `declare output '${problem.name}'`,
  } as const
  return problem.kind === 'invalid'
    ? createMfeError({
        ...declaration,
        expected: 'a lower-camel-case output name, for example "acknowledged"',
        observed: JSON.stringify(problem.name),
        repair: renameRepair,
      })
    : createMfeError({
        ...declaration,
        expected: 'output names that map to distinct handler props',
        observed: `'${problem.existing}' and '${problem.name}' both map to ${problem.handlerProp}`,
        repair: `Rename one of them, for example '${problem.name}Completed'.`,
      })
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
          ? 'a function. A consumer that needs a callback subscribes to an output instead'
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
  readonly direction: 'input' | 'output'
  /** `'provider'` validates its own declaration; `'consumer'` what it subscribed to. */
  readonly side: 'provider' | 'consumer'
  readonly outputName?: string
}

export type ContractValidation<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: MfeError }

function failureBase(
  context: ContractValidationContext,
): Pick<MfeErrorDetails, 'code' | 'id' | 'operation' | 'direction' | 'definitionVersion'> {
  const isInput = context.direction === 'input'
  return {
    code: isInput ? 'contract/input-mismatch' : 'contract/output-mismatch',
    id: context.id,
    ...(context.definitionVersion === undefined
      ? {}
      : { definitionVersion: context.definitionVersion }),
    operation: isInput ? 'accept input' : `emit output '${context.outputName ?? 'unknown'}'`,
    direction: context.direction,
  }
}

function repairFor(context: ContractValidationContext, field: string): string {
  if (context.direction === 'input') return `Check the ${field || 'input'} prop on the Widget.`
  const output = context.outputName ?? 'output'
  return context.side === 'provider'
    ? `Check the payload passed to emit('${output}', …).`
    : `Check the '${output}' schema this consumer declared.`
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
