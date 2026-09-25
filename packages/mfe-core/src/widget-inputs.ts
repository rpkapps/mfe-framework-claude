/**
 * Reading the schemas a Widget publishes: one walk for every reader, because three separate ones
 * drifted as the emitter learned constructs a reader then reported as unreadable (§28). An output's
 * payload is walked by the same code as the inputs, so a host wiring one Widget's output into
 * another's inputs compares like with like.
 */

import type { JsonSchemaObject, JsonSchemaValue, PublishedContract } from './definition.ts'

/** The vocabulary the build emits; `unknown` is a schema this cannot classify. */
export type WidgetInputKind =
  'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'const' | 'array' | 'object' | 'unknown'

/** What one value may be; also describes an array's elements. */
export interface WidgetInputType {
  readonly kind: WidgetInputKind
  /** The schema admits `null` beside the value, from `.nullable()`/`.nullish()`. */
  readonly nullable: boolean
  /** JSON Schema `format` for a string kind: `uri`, `email`, `date-time`, … */
  readonly format?: string
  /** The declared members, in declaration order. */
  readonly enumValues?: readonly JsonSchemaValue[]
  readonly constValue?: JsonSchemaValue
  readonly item?: WidgetInputType
  /** The field's own schema, with the nullable wrapper unwrapped. */
  readonly schema: JsonSchemaObject
}

export interface WidgetInputField extends WidgetInputType {
  readonly name: string
  /** A defaulted field is not required: the build marks it optional. */
  readonly required: boolean
  readonly defaultValue?: JsonSchemaValue
  readonly description?: string
}

/** `Array.isArray` narrows to `any[]`, so these assert what the preceding check established. */
function asObject(value: JsonSchemaValue | undefined): JsonSchemaObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonSchemaObject)
    : undefined
}

function asArray(value: JsonSchemaValue | undefined): readonly JsonSchemaValue[] | undefined {
  return Array.isArray(value) ? (value as readonly JsonSchemaValue[]) : undefined
}

type Unwrapped = { readonly schema: JsonSchemaObject; readonly nullable: boolean }

/**
 * A nullable field is published as the value schema beside `{ type: 'null' }` under `anyOf`; any
 * other `anyOf` is left alone, because a genuine union is not something one control stands for.
 */
function unwrapNullable(schema: JsonSchemaObject): Unwrapped {
  const members = asArray(schema['anyOf'])
  if (members === undefined) return { schema, nullable: false }

  let value: JsonSchemaObject | undefined
  let sawNull = false
  let unreadable = false

  for (const member of members) {
    const object = asObject(member)
    if (object === undefined) unreadable = true
    else if (object['type'] === 'null') sawNull = true
    else if (value === undefined) value = object
    else unreadable = true
  }

  if (unreadable || !sawNull || value === undefined) return { schema, nullable: false }

  const merged: Record<string, JsonSchemaValue> = { ...unwrapNullable(value).schema }
  for (const [key, entry] of Object.entries(schema)) {
    if (key !== 'anyOf') merged[key] = entry
  }
  return { schema: merged, nullable: true }
}

const TYPED_KINDS: readonly string[] = ['string', 'number', 'integer', 'boolean', 'array', 'object']

function kindOf(schema: JsonSchemaObject): WidgetInputKind {
  // An enum and a literal carry no `type`, so reading `type` first would classify both unknown.
  if (asArray(schema['enum']) !== undefined) return 'enum'
  if (schema['const'] !== undefined) return 'const'

  const type = schema['type']
  return typeof type === 'string' && TYPED_KINDS.includes(type)
    ? (type as WidgetInputKind)
    : 'unknown'
}

function describeType(raw: JsonSchemaObject): WidgetInputType {
  const { schema, nullable } = unwrapNullable(raw)
  const kind = kindOf(schema)
  const format = schema['format']
  const members = asArray(schema['enum'])
  const constValue = schema['const']
  const items = kind === 'array' ? asObject(schema['items']) : undefined

  return {
    kind,
    nullable,
    schema,
    ...(typeof format === 'string' ? { format } : {}),
    ...(members === undefined ? {} : { enumValues: [...members] }),
    ...(constValue === undefined ? {} : { constValue }),
    ...(items === undefined ? {} : { item: describeType(items) }),
  }
}

export interface WidgetOutput {
  readonly name: string
  /** The payload's own schema; `{}` when the build could not read it. */
  readonly schema: JsonSchemaObject
  /** The payload's fields, or `null` when it is not an object schema this can read. */
  readonly payload: readonly WidgetInputField[] | null
}

/** `null` is "the build could not describe this", where `[]` is "this Widget takes nothing" (§28). */
export function describeInputs(
  contract: PublishedContract | undefined,
): readonly WidgetInputField[] | null {
  return describeFields(contract?.inputSchema)
}

/**
 * The declared outputs, in declaration order. `null` is "the build could not read the names",
 * where `[]` is "this Widget emits nothing", as for the inputs (§28). `required` is not read:
 * every output may never be emitted.
 */
export function describeOutputs(
  contract: PublishedContract | undefined,
): readonly WidgetOutput[] | null {
  const properties = asObject(contract?.outputSchema?.['properties'])
  if (properties === undefined) return null

  return Object.entries(properties).map(([name, value]) => {
    const schema = asObject(value) ?? {}
    return { name, schema, payload: describeFields(schema) }
  })
}

function describeFields(schema: JsonSchemaObject | undefined): readonly WidgetInputField[] | null {
  if (schema === undefined) return null

  const properties = asObject(schema['properties'])
  if (properties === undefined) return null

  // An entry comes from a build this side does not control, so `required` is unvalidated JSON.
  const declared = asArray(schema['required']) ?? []
  const required = new Set(declared.filter(name => typeof name === 'string'))

  return Object.entries(properties).map(([name, value]) => {
    const type = describeType(asObject(value) ?? {})
    const defaultValue = type.schema['default']
    const description = type.schema['description']

    return {
      name,
      required: required.has(name),
      ...type,
      ...(typeof description === 'string' ? { description } : {}),
      ...(defaultValue === undefined ? {} : { defaultValue }),
    }
  })
}

/** Only the defaults the schema itself declares, with nothing invented beside them. */
export function defaultInputsFor(
  fields: readonly WidgetInputField[] | null,
): Record<string, JsonSchemaValue> {
  const inputs: Record<string, JsonSchemaValue> = {}
  if (fields === null) return inputs

  for (const field of fields) {
    if (field.defaultValue !== undefined) inputs[field.name] = field.defaultValue
  }
  return inputs
}

/**
 * Collected values are text, and `"12"` is not the number the schema asks for; a blank optional
 * field is left out so it arrives absent rather than as an empty string the schema rejects.
 */
export function coerceInputs(
  fields: readonly WidgetInputField[] | null,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (fields === null) return { ...values }

  const inputs: Record<string, unknown> = {}
  for (const field of fields) {
    const value = values[field.name]
    if (value === undefined) continue
    if (value === '' && !field.required) continue
    inputs[field.name] = coerceValue(field, value)
  }
  return inputs
}

/** An unpublished schema counts as needing a prompt, because the host then knows nothing. */
export function needsInputPrompt(contract: PublishedContract | undefined): boolean {
  const fields = describeInputs(contract)
  return fields === null || fields.some(field => field.required)
}

/** An unconvertible value passes through unchanged, so the provider's error names what it got. */
function coerceValue(type: WidgetInputType, value: unknown): unknown {
  // Only text needs converting; a value already of a JSON type came from a control that knew it.
  if (typeof value !== 'string') return value

  switch (type.kind) {
    case 'number':
    case 'integer': {
      const parsed = Number(value)
      return value.trim() === '' || !Number.isFinite(parsed) ? value : parsed
    }
    case 'boolean':
      return value === 'true' ? true : value === 'false' ? false : value
    case 'enum':
      return asMember(type.enumValues ?? [], value)
    case 'const':
      return type.constValue === undefined ? value : asMember([type.constValue], value)
    case 'array':
    case 'object':
      return asJson(value)
    case 'string':
    case 'unknown':
      return value
  }
}

/** The declared member a string stands for: `"3"` is not the `3` an enum declares. */
function asMember(members: readonly JsonSchemaValue[], value: string): JsonSchemaValue {
  const stringly = (member: JsonSchemaValue): boolean =>
    member !== null && typeof member !== 'object' && String(member) === value
  return members.find(member => member === value) ?? members.find(stringly) ?? value
}

function asJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}
