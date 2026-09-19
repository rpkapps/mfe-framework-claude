/**
 * Reading the input schema a Widget publishes, so the shell can ask for its
 * inputs before the container is ever fetched.
 *
 * The schema is the one the Widget's provider validates against, emitted as
 * JSON Schema by that container's own build. Nothing here re-implements the
 * validation: the provider still rejects what it rejects, and a tile that is
 * given the wrong thing shows the contract error. This only decides which
 * control to put on screen and how to turn what was typed into a value of the
 * declared type — `"12"` from a text input is not the number the schema asks
 * for, and a Widget that receives it fails for a reason the developer would
 * blame on the framework.
 */

import type { JsonSchemaObject, JsonSchemaValue, PublishedWidgetContract } from '@company/mfe-react'

export type FieldControl = 'text' | 'number' | 'boolean' | 'choice' | 'json'

export interface InputField {
  readonly name: string
  readonly control: FieldControl
  readonly required: boolean
  readonly description?: string
  /** Present for `choice`. */
  readonly options?: readonly string[]
  readonly defaultValue?: JsonSchemaValue
  /** For the JSON escape hatch and the "what does this take" readout. */
  readonly typeLabel: string
}

function asObject(value: JsonSchemaValue | undefined): JsonSchemaObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonSchemaObject)
    : undefined
}

function controlFor(schema: JsonSchemaObject): FieldControl {
  if (Array.isArray(schema['enum'])) return 'choice'
  const type = schema['type']
  if (type === 'boolean') return 'boolean'
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'string') return 'text'
  // Arrays, nested objects and anything the schema leaves open keep their JSON
  // form rather than being flattened into a text box that silently drops it.
  return 'json'
}

function typeLabelFor(schema: JsonSchemaObject): string {
  const members = schema['enum']
  if (Array.isArray(members)) return members.map(member => String(member)).join(' | ')
  const type = schema['type']
  if (typeof type === 'string') {
    const itemType = asObject(schema['items'])?.['type']
    return type === 'array' ? `${typeof itemType === 'string' ? itemType : 'value'}[]` : type
  }
  return 'value'
}

/**
 * The fields to ask for, or `null` when the Widget published no readable
 * schema. `null` is not "no fields": it means the shell does not know, and the
 * dialog offers raw JSON instead of pretending the Widget takes nothing.
 */
export function readInputFields(
  contract: PublishedWidgetContract | undefined,
): readonly InputField[] | null {
  const inputs = contract?.inputs
  if (inputs === undefined) return null

  const properties = asObject(inputs['properties'])
  if (properties === undefined) return null

  const required = Array.isArray(inputs['required'])
    ? inputs['required'].map(name => String(name))
    : []

  return Object.entries(properties).map(([name, value]) => {
    const schema = asObject(value) ?? {}
    const members = schema['enum']
    const description = schema['description']
    const defaultValue = schema['default']

    return {
      name,
      control: controlFor(schema),
      required: required.includes(name),
      typeLabel: typeLabelFor(schema),
      ...(typeof description === 'string' ? { description } : {}),
      ...(Array.isArray(members) ? { options: members.map(member => String(member)) } : {}),
      ...(defaultValue === undefined ? {} : { defaultValue }),
    }
  })
}

/** What the dialog opens with: declared defaults, or whatever the tile already has. */
export function initialValues(
  fields: readonly InputField[] | null,
  current: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (fields === null) return { ...current }

  const values: Record<string, unknown> = {}
  for (const field of fields) {
    if (Object.hasOwn(current, field.name)) {
      values[field.name] = current[field.name]
      continue
    }
    if (field.defaultValue !== undefined) values[field.name] = field.defaultValue
    else if (field.control === 'boolean') values[field.name] = false
    else values[field.name] = ''
  }
  return values
}

/**
 * Drops the fields the author left blank, so an optional input arrives absent
 * rather than as an empty string the schema then rejects. A required field left
 * blank is kept and allowed to fail at the Widget's own boundary — the error it
 * raises names the field and the repair, which an invented shell message would
 * only paraphrase.
 */
export function toInputs(
  fields: readonly InputField[] | null,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (fields === null) return { ...values }

  const inputs: Record<string, unknown> = {}
  for (const field of fields) {
    const value = values[field.name]
    if (value === '' && !field.required) continue
    if (value === undefined) continue
    inputs[field.name] = field.control === 'number' && value !== '' ? Number(value) : value
  }
  return inputs
}

/** A one-line summary of a tile's inputs, for the tile header. */
export function summarizeInputs(inputs: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(inputs)
  if (entries.length === 0) return 'no inputs'
  return entries
    .map(([name, value]) => `${name}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ')
}
