/**
 * Reading the input schema a Widget publishes, without deciding anything about
 * how it is presented.
 *
 * The walk lives once, here, because three readers need it — a form, a
 * developer tool, a picker — and three separate walks drift apart as the
 * emitter learns constructs (`format`, `const`, a nullable `anyOf`) that a
 * reader then reports as unreadable. What comes out is data; which control to
 * draw belongs to whoever draws the page. Nothing here validates.
 */

import type { JsonSchemaObject, JsonSchemaValue, PublishedWidgetContract } from './definition.ts'

/**
 * What kind of value a field takes, in the vocabulary the build emits. `const`
 * is a single literal, `unknown` a schema this cannot classify.
 */
export type WidgetInputKind =
  'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'const' | 'array' | 'object' | 'unknown'

/** What one value may be. Also describes an array's elements. */
export interface WidgetInputType {
  readonly kind: WidgetInputKind
  /** The schema admits `null` beside the value, from `.nullable()`/`.nullish()`. */
  readonly nullable: boolean
  /** JSON Schema `format` for a string kind: `uri`, `email`, `date-time`, … */
  readonly format?: string
  /** The declared members, for `enum`. Order is the declaration order. */
  readonly enumValues?: readonly JsonSchemaValue[]
  /** The single declared value, for `const`. */
  readonly constValue?: JsonSchemaValue
  /** The element type, for `array`. */
  readonly item?: WidgetInputType
  /** The field's own schema, with the nullable wrapper unwrapped. */
  readonly schema: JsonSchemaObject
}

/** One declared input of a Widget. */
export interface WidgetInputField extends WidgetInputType {
  readonly name: string
  /** Required by the schema. A defaulted field is not: the build marks it optional. */
  readonly required: boolean
  readonly defaultValue?: JsonSchemaValue
  readonly description?: string
}

/**
 * `Array.isArray` narrows to `any[]` and does not narrow a `readonly` array out
 * of the union, so these assert what the check in front of them established.
 * Every read below goes through them rather than through `any`.
 */
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
 * A nullable field is published as the value schema and `{ type: 'null' }`
 * under `anyOf`, with whatever was chained after `.nullable()` on the wrapper;
 * merging the wrapper's keys over the value schema makes "a string" and "a
 * string or null" one field with one flag different. Any other `anyOf` is left
 * alone — a genuine union is not something a control can stand in for.
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

/** The `type` values that name a kind directly. */
const TYPED_KINDS = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object'])

function kindOf(schema: JsonSchemaObject): WidgetInputKind {
  // Order matters: an enum and a literal carry their members instead of a
  // `type`, so reading `type` first would classify both as unknown.
  if (asArray(schema['enum']) !== undefined) return 'enum'
  if (schema['const'] !== undefined) return 'const'

  const type = schema['type']
  return typeof type === 'string' && TYPED_KINDS.has(type) ? (type as WidgetInputKind) : 'unknown'
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

/**
 * The fields a Widget declares, or `null` when its schema was not published or
 * cannot be read as an object of properties. The two are different answers: an
 * empty array is "this Widget takes nothing", `null` is "the build could not
 * describe what it takes", and a host offers a raw value for the second.
 */
export function describeWidgetInputs(
  contract: PublishedWidgetContract | undefined,
): readonly WidgetInputField[] | null {
  const inputs = contract?.inputs
  if (inputs === undefined) return null

  const properties = asObject(inputs['properties'])
  if (properties === undefined) return null

  // A descriptor comes from a build this side does not control, so `required`
  // is only known to be some JSON value until it is read.
  const declared = asArray(inputs['required']) ?? []
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

/**
 * The inputs a Widget can be mounted with when nobody is asked for anything:
 * the defaults its own schema declares, and nothing invented beside them. A
 * field with no default is left absent, which is what "optional" means.
 */
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
 * Turns collected values — from a form, a query string, a stored layout — into
 * inputs of the declared types: `"12"` typed into a text box is not the number
 * the schema asks for. A blank optional field is left out so it arrives absent
 * rather than as an empty string the schema rejects; a blank *required* one is
 * kept and allowed to fail at the Widget's boundary. With no readable schema
 * the values pass through as they are.
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

/**
 * Must a host ask for inputs before this Widget can be mounted? True when the
 * schema was not published — the host knows nothing — and when any field is
 * required. All-optional inputs need nothing from anybody, and asking is
 * ceremony.
 */
export function needsInputPrompt(contract: PublishedWidgetContract | undefined): boolean {
  const fields = describeWidgetInputs(contract)
  return fields === null || fields.some(field => field.required)
}

/**
 * A value that cannot be converted is passed through unchanged rather than
 * replaced by `NaN` or dropped: the provider's own error names the field and
 * what it received, and it can only do that if it receives what was given.
 */
function coerceValue(type: WidgetInputType, value: unknown): unknown {
  // Only text needs converting: anything already of a JSON type came from a
  // control that knew the type, or from inputs coerced once already.
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
