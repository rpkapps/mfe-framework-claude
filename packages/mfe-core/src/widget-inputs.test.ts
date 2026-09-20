import { describe, expect, it } from 'vitest'

import type { JsonSchemaObject, PublishedWidgetContract } from './definition.ts'
import {
  coerceInputs,
  defaultInputsFor,
  describeWidgetInputs,
  needsInputPrompt,
  type WidgetInputField,
  type WidgetInputKind,
} from './widget-inputs.ts'

function contractOf(
  properties: Readonly<Record<string, JsonSchemaObject>>,
  required: readonly string[] = [],
): PublishedWidgetContract {
  return {
    events: [],
    inputs: {
      title: 'alert-panel inputs',
      type: 'object',
      properties,
      ...(required.length > 0 ? { required: [...required] } : {}),
      additionalProperties: false,
    },
  }
}

function fieldsOf(
  properties: Readonly<Record<string, JsonSchemaObject>>,
  required: readonly string[] = [],
): readonly WidgetInputField[] {
  const fields = describeWidgetInputs(contractOf(properties, required))
  if (fields === null) throw new Error('expected the schema to be readable')
  return fields
}

describe('describeWidgetInputs', () => {
  it('tells a schema that was never published from one that takes nothing', () => {
    expect(describeWidgetInputs(undefined)).toBeNull()
    expect(describeWidgetInputs({ events: ['acknowledged'] })).toBeNull()
    expect(describeWidgetInputs(contractOf({}))).toEqual([])
  })

  it('reports a schema it cannot read as properties as unpublished rather than as empty', () => {
    expect(describeWidgetInputs({ events: [], inputs: { type: 'object' } })).toBeNull()
    expect(describeWidgetInputs({ events: [], inputs: { properties: ['alertId'] } })).toBeNull()
  })

  it('marks the fields the schema lists as required, in declaration order', () => {
    const fields = fieldsOf({ alertId: { type: 'string' }, severity: { type: 'string' } }, [
      'alertId',
    ])

    expect(fields.map(field => [field.name, field.required])).toEqual([
      ['alertId', true],
      ['severity', false],
    ])
  })

  it('survives a `required` that is not a list of names', () => {
    const fields = describeWidgetInputs({
      events: [],
      inputs: { properties: { alertId: {} }, required: 'alertId' },
    })

    expect(fields).toEqual([
      { name: 'alertId', required: false, kind: 'unknown', nullable: false, schema: {} },
    ])
  })

  it('carries the default, the description and the declared members', () => {
    const [field] = fieldsOf({
      severity: {
        enum: ['info', 'warning', 'critical'],
        default: 'info',
        description: 'How loud the panel is',
      },
    })

    expect(field).toMatchObject({
      kind: 'enum',
      enumValues: ['info', 'warning', 'critical'],
      defaultValue: 'info',
      description: 'How loud the panel is',
    })
  })

  it('keeps the string format the build read, instead of flattening it to "a string"', () => {
    const [field] = fieldsOf({ homepage: { type: 'string', format: 'uri' } })

    expect(field).toMatchObject({ kind: 'string', format: 'uri' })
  })

  it('reads a nullable field as its value type with a flag, not as an unreadable union', () => {
    const [field] = fieldsOf({
      note: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        default: null,
        description: 'Optional note',
      },
    })

    expect(field).toMatchObject({
      kind: 'string',
      nullable: true,
      defaultValue: null,
      description: 'Optional note',
    })
  })

  it('describes an array by its element type', () => {
    const [field] = fieldsOf({
      compare: { type: 'array', items: { enum: ['initial', 'liner'] }, default: ['initial'] },
    })

    expect(field).toMatchObject({
      kind: 'array',
      item: { kind: 'enum', enumValues: ['initial', 'liner'] },
      defaultValue: ['initial'],
    })
  })

  it('marks a nested object rather than flattening it, and keeps its schema reachable', () => {
    const [field] = fieldsOf({
      range: {
        type: 'object',
        properties: { from: { type: 'number' } },
        required: ['from'],
        additionalProperties: false,
      },
    })

    expect(field?.kind).toBe('object')
    expect(field?.schema['properties']).toEqual({ from: { type: 'number' } })
  })

  it('leaves a genuine union unclassified rather than reporting its first member', () => {
    const [field] = fieldsOf({ either: { anyOf: [{ type: 'string' }, { type: 'number' }] } })

    expect(field).toMatchObject({ kind: 'unknown', nullable: false })
  })
})

describe('defaultInputsFor', () => {
  it('mounts a Widget with the defaults its schema declares and nothing else', () => {
    const fields = fieldsOf({
      heading: { type: 'string', default: 'AI Agent' },
      subtitle: { type: 'string' },
      showActions: { type: 'boolean', default: true },
    })

    expect(defaultInputsFor(fields)).toEqual({ heading: 'AI Agent', showActions: true })
  })

  it('has nothing to offer when the schema was never published', () => {
    expect(defaultInputsFor(null)).toEqual({})
  })
})

describe('coerceInputs', () => {
  it('turns typed text into the declared type', () => {
    const fields = fieldsOf({
      retries: { type: 'number' },
      attempts: { type: 'integer' },
      loud: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
    })

    expect(
      coerceInputs(fields, {
        retries: '12',
        attempts: '3',
        loud: 'true',
        tags: '["a","b"]',
      }),
    ).toEqual({ retries: 12, attempts: 3, loud: true, tags: ['a', 'b'] })
  })

  it('picks the declared member a text control could only hand back as text', () => {
    const fields = fieldsOf({ level: { enum: [1, 2, 3] }, mode: { const: 'strict' } })

    expect(coerceInputs(fields, { level: '2', mode: 'strict' })).toEqual({
      level: 2,
      mode: 'strict',
    })
  })

  it('passes a value it cannot convert through, so the Widget reports it by name', () => {
    const fields = fieldsOf({ retries: { type: 'number' }, tags: { type: 'array' } })

    expect(coerceInputs(fields, { retries: 'twelve', tags: 'not json' })).toEqual({
      retries: 'twelve',
      tags: 'not json',
    })
  })

  it('drops a blank optional field and keeps a blank required one', () => {
    const fields = fieldsOf({ alertId: { type: 'string' }, note: { type: 'string' } }, ['alertId'])

    expect(coerceInputs(fields, { alertId: '', note: '' })).toEqual({ alertId: '' })
  })

  it('ignores values the schema does not declare', () => {
    const fields = fieldsOf({ alertId: { type: 'string' } }, ['alertId'])

    expect(coerceInputs(fields, { alertId: 'a-1', invented: 'x' })).toEqual({ alertId: 'a-1' })
  })

  it('passes everything through when there is no schema to coerce against', () => {
    expect(coerceInputs(null, { anything: { nested: true } })).toEqual({
      anything: { nested: true },
    })
  })
})

describe('needsInputPrompt', () => {
  it('asks when the build published no schema, because the host knows nothing', () => {
    expect(needsInputPrompt(undefined)).toBe(true)
    expect(needsInputPrompt({ events: [] })).toBe(true)
  })

  it('asks for a required field, and does not for one that is optional or defaulted', () => {
    expect(needsInputPrompt(contractOf({ alertId: { type: 'string' } }, ['alertId']))).toBe(true)
    expect(needsInputPrompt(contractOf({ heading: { type: 'string', default: 'x' } }))).toBe(false)
    expect(needsInputPrompt(contractOf({}))).toBe(false)
  })
})

/**
 * The drift guard: every construct `readStaticSchema` can emit is listed here, and a row whose kind
 * comes back `unknown` is this reflector falling behind the emitter (§28).
 */
interface EmittedConstruct {
  /** What an author wrote, for whoever has to repair this row. */
  readonly zod: string
  readonly schema: JsonSchemaObject
  readonly kind: WidgetInputKind
}

const EMITTED_CONSTRUCTS: readonly EmittedConstruct[] = [
  { zod: 'z.string()', schema: { type: 'string' }, kind: 'string' },
  { zod: 'z.number()', schema: { type: 'number' }, kind: 'number' },
  { zod: 'z.int()', schema: { type: 'integer' }, kind: 'integer' },
  { zod: 'z.boolean()', schema: { type: 'boolean' }, kind: 'boolean' },
  { zod: "z.literal('strict')", schema: { const: 'strict' }, kind: 'const' },
  { zod: 'z.literal(7)', schema: { const: 7 }, kind: 'const' },
  {
    zod: "z.enum(['staging', 'production'])",
    schema: { enum: ['staging', 'production'] },
    kind: 'enum',
  },
  {
    zod: 'z.array(z.string())',
    schema: { type: 'array', items: { type: 'string' } },
    kind: 'array',
  },
  {
    zod: 'z.object({ retries: z.number() })',
    schema: {
      type: 'object',
      properties: { retries: { type: 'number' } },
      required: ['retries'],
      additionalProperties: false,
    },
    kind: 'object',
  },

  { zod: 'z.url()', schema: { type: 'string', format: 'uri' }, kind: 'string' },
  { zod: 'z.email()', schema: { type: 'string', format: 'email' }, kind: 'string' },
  { zod: 'z.uuid()', schema: { type: 'string', format: 'uuid' }, kind: 'string' },
  { zod: 'z.ulid()', schema: { type: 'string', format: 'ulid' }, kind: 'string' },
  { zod: 'z.cuid()', schema: { type: 'string', format: 'cuid' }, kind: 'string' },
  { zod: 'z.ip()', schema: { type: 'string', format: 'ipv4' }, kind: 'string' },
  { zod: 'z.ipv4()', schema: { type: 'string', format: 'ipv4' }, kind: 'string' },
  { zod: 'z.ipv6()', schema: { type: 'string', format: 'ipv6' }, kind: 'string' },
  { zod: 'z.datetime()', schema: { type: 'string', format: 'date-time' }, kind: 'string' },
  { zod: 'z.date()', schema: { type: 'string', format: 'date' }, kind: 'string' },
  { zod: 'z.time()', schema: { type: 'string', format: 'time' }, kind: 'string' },
  { zod: 'z.duration()', schema: { type: 'string', format: 'duration' }, kind: 'string' },
  { zod: 'z.string().email()', schema: { type: 'string', format: 'email' }, kind: 'string' },

  {
    zod: 'z.string().min(1).max(8)',
    schema: { type: 'string', minLength: 1, maxLength: 8 },
    kind: 'string',
  },
  {
    zod: 'z.string().length(4)',
    schema: { type: 'string', minLength: 4, maxLength: 4 },
    kind: 'string',
  },
  {
    zod: 'z.array(z.string()).min(1).max(4)',
    schema: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    kind: 'array',
  },
  {
    zod: 'z.number().min(1).max(10)',
    schema: { type: 'number', minimum: 1, maximum: 10 },
    kind: 'number',
  },
  { zod: 'z.number().int()', schema: { type: 'integer' }, kind: 'integer' },
  { zod: 'z.number().positive()', schema: { type: 'number', exclusiveMinimum: 0 }, kind: 'number' },
  { zod: 'z.number().nonnegative()', schema: { type: 'number', minimum: 0 }, kind: 'number' },
  { zod: 'z.number().negative()', schema: { type: 'number', exclusiveMaximum: 0 }, kind: 'number' },
  { zod: 'z.number().nonpositive()', schema: { type: 'number', maximum: 0 }, kind: 'number' },
  {
    zod: 'z.string().regex(/^[a-z]+$/)',
    schema: { type: 'string', pattern: '^[a-z]+$' },
    kind: 'string',
  },
  {
    zod: "z.string().startsWith('a-')",
    schema: { type: 'string', pattern: '^a\\-' },
    kind: 'string',
  },
  {
    zod: "z.string().endsWith('.md')",
    schema: { type: 'string', pattern: '\\.md$' },
    kind: 'string',
  },
  { zod: 'z.string().trim().toLowerCase()', schema: { type: 'string' }, kind: 'string' },
  {
    zod: "z.string().describe('what it is')",
    schema: { type: 'string', description: 'what it is' },
    kind: 'string',
  },
  { zod: "z.string().default('a-1')", schema: { type: 'string', default: 'a-1' }, kind: 'string' },

  {
    zod: 'z.string().nullable()',
    schema: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    kind: 'string',
  },
  {
    zod: 'z.string().nullish()',
    schema: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    kind: 'string',
  },
  {
    zod: 'z.number().nullable().default(3)',
    schema: { anyOf: [{ type: 'number' }, { type: 'null' }], default: 3 },
    kind: 'number',
  },
  {
    zod: "z.enum(['a', 'b']).nullable().describe('either')",
    schema: { anyOf: [{ enum: ['a', 'b'] }, { type: 'null' }], description: 'either' },
    kind: 'enum',
  },
  {
    zod: 'z.array(z.number()).nullable()',
    schema: { anyOf: [{ type: 'array', items: { type: 'number' } }, { type: 'null' }] },
    kind: 'array',
  },
]

describe('every construct the build can publish', () => {
  it('is classified, so no published field degrades to a raw JSON box', () => {
    const properties: Record<string, JsonSchemaObject> = {}
    for (const [index, construct] of EMITTED_CONSTRUCTS.entries()) {
      properties[`field${String(index)}`] = construct.schema
    }

    const fields = fieldsOf(properties)

    const unclassified = fields
      .filter(field => field.kind === 'unknown')
      .map(field => EMITTED_CONSTRUCTS[Number(field.name.slice('field'.length))]?.zod)

    expect(unclassified).toEqual([])
  })

  it.each(EMITTED_CONSTRUCTS)('reads $zod as $kind', construct => {
    const [field] = fieldsOf({ value: construct.schema })

    expect(field?.kind).toBe(construct.kind)
  })

  it('reads through the nullable wrapper for what was chained after it', () => {
    const fields = fieldsOf({
      retries: { anyOf: [{ type: 'number' }, { type: 'null' }], default: 3 },
      choice: { anyOf: [{ enum: ['a', 'b'] }, { type: 'null' }], description: 'either' },
    })

    expect(fields[0]).toMatchObject({ kind: 'number', nullable: true, defaultValue: 3 })
    expect(fields[1]).toMatchObject({
      kind: 'enum',
      nullable: true,
      enumValues: ['a', 'b'],
      description: 'either',
    })
  })
})
