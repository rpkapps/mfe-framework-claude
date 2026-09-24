/** How to *show* a Widget's declared inputs; reading the schema is `describeWidgetInputs`'s job, and nothing here validates (§28). */

import {
  describeWidgetEvents,
  describeWidgetInputs,
  type PublishedWidgetContract,
  type WidgetInputField,
  type WidgetInputType,
} from '@company/mfe-react'

export type FieldControl = 'text' | 'number' | 'boolean' | 'choice' | 'json'

/** A declared input, plus what this shell decided to draw for it. */
export interface InputField extends WidgetInputField {
  readonly control: FieldControl
  readonly options?: readonly string[]
  readonly typeLabel: string
}

function controlFor(type: WidgetInputType): FieldControl {
  const kind = type.kind === 'const' ? typeof type.constValue : type.kind
  if (kind === 'enum') return 'choice'
  if (kind === 'boolean') return 'boolean'
  if (kind === 'number' || kind === 'integer') return 'number'
  if (kind === 'string') return 'text'
  return 'json'
}

/** Never `[object Object]`: a structured member keeps its JSON. */
function memberLabel(member: unknown): string {
  return typeof member === 'string' ? member : (JSON.stringify(member) ?? 'value')
}

function typeName(type: WidgetInputType): string {
  const { kind } = type
  if (kind === 'enum') return (type.enumValues ?? []).map(memberLabel).join(' | ')
  if (kind === 'const') return JSON.stringify(type.constValue) ?? 'value'
  if (kind === 'string') return type.format === undefined ? 'string' : `string (${type.format})`
  if (kind !== 'array') return kind === 'unknown' ? 'value' : kind
  const item = type.item === undefined ? 'value' : typeName(type.item)
  // Bracketed, or `a | b[]` reads as a union with an array in it.
  return item.includes(' | ') ? `(${item})[]` : `${item}[]`
}

/** `null` is "the build could not describe this", never "no fields": the dialog offers raw JSON instead (§28). */
export function readInputFields(
  contract: PublishedWidgetContract | undefined,
): readonly InputField[] | null {
  return (
    describeWidgetInputs(contract)?.map(field => ({
      ...field,
      control: controlFor(field),
      typeLabel: field.nullable ? `${typeName(field)} | null` : typeName(field),
      ...(field.kind === 'enum' ? { options: (field.enumValues ?? []).map(memberLabel) } : {}),
    })) ?? null
  )
}

/** A declared event, with its payload in one line for a tooltip. */
export interface EventDetail {
  readonly name: string
  readonly payloadLabel: string
}

/** `null` is "the build could not read the event names", never "emits nothing" (§28). */
export function readEvents(
  contract: PublishedWidgetContract | undefined,
): readonly EventDetail[] | null {
  return (
    describeWidgetEvents(contract)?.map(event => ({
      name: event.name,
      payloadLabel:
        event.payload === null
          ? 'payload not published'
          : event.payload.length === 0
            ? 'no payload'
            : `{ ${event.payload
                .map(field => {
                  const type = field.nullable ? `${typeName(field)} | null` : typeName(field)
                  return `${field.name}${field.required ? '' : '?'}: ${type}`
                })
                .join(', ')} }`,
    })) ?? null
  )
}

/** What the dialog opens with: the tile's value, the declared default, or a blank. */
export function initialValues(
  fields: readonly InputField[] | null,
  current: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (fields === null) return { ...current }
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    if (Object.hasOwn(current, field.name)) values[field.name] = current[field.name]
    else if (field.defaultValue !== undefined) values[field.name] = field.defaultValue
    else values[field.name] = field.control === 'boolean' ? false : ''
  }
  return values
}

/** A one-line summary of a tile's inputs, for the tile header. */
export function summarizeInputs(inputs: Readonly<Record<string, unknown>>): string {
  const pairs = Object.entries(inputs).map(([name, value]) => `${name}=${memberLabel(value)}`)
  return pairs.length === 0 ? 'no inputs' : pairs.join(' · ')
}
