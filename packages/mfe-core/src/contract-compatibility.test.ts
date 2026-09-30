import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  compareJsonSchemas,
  comparePublishedContracts,
  compareWidgetContracts,
} from './contract-compatibility.ts'
import type { WidgetContract } from './contract.ts'

function contract(inputSchema: z.ZodType, outputSchema = z.object({})): WidgetContract {
  return { inputSchema, outputSchema }
}

describe('Widget contract compatibility', () => {
  it('checks legacy output-only expectations without inventing an input requirement', () => {
    const consumer = { outputSchema: z.object({ selected: z.string() }) }
    const provider = {
      inputSchema: z.string().refine(() => true),
      outputSchema: z.object({ selected: z.string() }),
    }
    expect(compareWidgetContracts(consumer, provider)).toEqual({ status: 'compatible', issues: [] })
    expect(
      compareWidgetContracts(consumer, { ...provider, outputSchema: z.object({}) }),
    ).toMatchObject({
      status: 'incompatible',
      issues: [{ direction: 'output', path: ['selected'] }],
    })
    expect(
      compareWidgetContracts(consumer, {
        ...provider,
        outputSchema: z.object({ selected: z.number() }),
      }),
    ).toMatchObject({
      status: 'incompatible',
      issues: [{ direction: 'output', path: ['selected'] }],
    })
  })
  it('accepts optional provider inputs and additional provider outputs', () => {
    const consumer = {
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ selected: z.object({ id: z.string() }) }),
    }
    const provider = {
      inputSchema: z.object({ id: z.string(), theme: z.string().optional() }),
      outputSchema: z.object({
        selected: z.object({ id: z.string(), label: z.string() }),
        closed: z.object({}),
      }),
    }
    expect(compareWidgetContracts(consumer, provider)).toEqual({ status: 'compatible', issues: [] })
  })

  it('rejects a required provider input absent from the consumer contract', () => {
    const result = compareWidgetContracts(
      contract(z.object({ id: z.string() })),
      contract(z.object({ id: z.string(), tenant: z.string() })),
    )
    expect(result).toMatchObject({ status: 'incompatible', issues: [{ direction: 'input' }] })
  })

  it('rejects a provider making a previously optional input required', () => {
    expect(
      compareWidgetContracts(
        contract(z.object({ id: z.string().optional() })),
        contract(z.object({ id: z.string() })),
      ).status,
    ).toBe('incompatible')
  })

  it('accepts provider defaults without executing their factory', () => {
    const defaultValue = vi.fn(() => 'automatic')
    const consumer = contract(z.object({}))
    const provider = contract(z.object({ id: z.string().default(defaultValue) }))
    expect(compareWidgetContracts(consumer, provider).status).toBe('compatible')
    expect(defaultValue).not.toHaveBeenCalled()
  })

  it('checks accepted input and emitted output enum changes in opposite directions', () => {
    const consumer = {
      inputSchema: z.object({ mode: z.enum(['a', 'b']) }),
      outputSchema: z.object({ changed: z.enum(['a', 'b']) }),
    }
    const narrowerInput = { ...consumer, inputSchema: z.object({ mode: z.enum(['a']) }) }
    const broaderOutput = {
      ...consumer,
      outputSchema: z.object({ changed: z.enum(['a', 'b', 'c']) }),
    }
    expect(compareWidgetContracts(consumer, narrowerInput)).toMatchObject({
      status: 'incompatible',
      issues: [{ direction: 'input' }],
    })
    expect(compareWidgetContracts(consumer, broaderOutput)).toMatchObject({
      status: 'incompatible',
      issues: [{ direction: 'output', path: ['changed'] }],
    })
    expect(
      compareWidgetContracts(consumer, {
        inputSchema: z.object({ mode: z.enum(['a', 'b', 'c']) }),
        outputSchema: z.object({ changed: z.enum(['a']) }),
      }).status,
    ).toBe('compatible')
  })

  it('rejects removed expected outputs, even if another schema is opaque', () => {
    const consumer = {
      inputSchema: z.string().refine(() => true),
      outputSchema: z.object({ selected: z.string() }),
    }
    const provider = contract(z.string())
    const result = compareWidgetContracts(consumer, provider)
    expect(result.status).toBe('incompatible')
    expect(result.issues.find(issue => issue.direction === 'output')).toEqual({
      status: 'incompatible',
      direction: 'output',
      path: ['selected'],
      reason: "The provider no longer declares expected output 'selected'.",
    })
  })

  it('treats opaque refinements, transforms, coercion, and recursive schemas as unknown', () => {
    const refine = vi.fn(() => true)
    const transform = vi.fn((value: string) => value.length)
    const lazy = vi.fn(() => z.string())
    for (const schema of [
      z.string().refine(refine),
      z.string().transform(transform),
      z.coerce.string(),
      z.lazy(lazy),
    ]) {
      expect(compareWidgetContracts(contract(schema), contract(z.string())).status).toBe('unknown')
    }
    expect(refine).not.toHaveBeenCalled()
    expect(transform).not.toHaveBeenCalled()
    expect(lazy).not.toHaveBeenCalled()
  })

  it('checks parsed output optionality after provider defaults', () => {
    const consumer = {
      inputSchema: z.object({}),
      outputSchema: z.object({ selected: z.object({ id: z.string() }) }),
    }
    const provider = {
      inputSchema: z.object({}),
      outputSchema: z.object({ selected: z.object({ id: z.string().default('automatic') }) }),
    }
    expect(compareWidgetContracts(consumer, provider).status).toBe('compatible')
  })

  it('checks nested object, string and array restrictions', () => {
    const consumer = contract(
      z.object({ ids: z.array(z.object({ id: z.string().min(2) })).min(1) }),
    )
    const provider = contract(
      z.object({ ids: z.array(z.object({ id: z.string().min(3) })).min(1) }),
    )
    expect(compareWidgetContracts(consumer, provider).status).toBe('incompatible')
    expect(compareWidgetContracts(provider, consumer).status).toBe('compatible')
  })

  it('retains the strongest repeated numeric, string, and array bounds', () => {
    for (const [consumer, provider] of [
      [z.number().min(1), z.number().min(2).min(1)],
      [z.number().max(10), z.number().max(5).max(10)],
      [z.string().min(1), z.string().min(2).min(1)],
      [z.string().max(10), z.string().max(5).max(10)],
      [z.string().min(1).max(3), z.string().length(2).min(1).max(3)],
      [z.array(z.string()).min(1), z.array(z.string()).min(2).min(1)],
      [z.array(z.string()).max(10), z.array(z.string()).max(5).max(10)],
    ] as const) {
      expect(compareWidgetContracts(contract(consumer), contract(provider)).status).toBe(
        'incompatible',
      )
    }
    expect(
      compareWidgetContracts(
        { inputSchema: z.object({}), outputSchema: z.object({ count: z.number().min(2) }) },
        { inputSchema: z.object({}), outputSchema: z.object({ count: z.number().min(2).min(1) }) },
      ).status,
    ).toBe('compatible')
  })

  it('includes implicit bounds for safe integer and int32 checks', () => {
    expect(
      compareWidgetContracts(contract(z.number().int()), contract(z.number().check(z.int32())))
        .status,
    ).toBe('incompatible')
    expect(
      compareWidgetContracts(contract(z.number().check(z.int32())), contract(z.number().int()))
        .status,
    ).toBe('compatible')
    expect(
      compareWidgetContracts(
        contract(z.number().check(z.int32())),
        contract(z.number().max(2147483647)),
      ).status,
    ).toBe('compatible')
    expect(compareWidgetContracts(contract(z.int32()), contract(z.number().int())).status).toBe(
      'unknown',
    )
  })

  it('does not assert tolerant raw inputs are compatible with a strict provider', () => {
    expect(
      compareWidgetContracts(
        contract(z.object({ id: z.string() })),
        contract(z.strictObject({ id: z.string() })),
      ).status,
    ).toBe('unknown')
  })

  it('keeps descendant restrictions unknown when an opaque parent predicate may imply them', () => {
    const consumer = contract(z.object({ id: z.string() }).refine(value => value.id.length === 0))
    const provider = contract(z.object({ id: z.string().max(0) }))
    expect(compareWidgetContracts(consumer, provider).status).toBe('unknown')
  })
})

describe('JSON Schema supported subset', () => {
  it('compares inclusive and exclusive number bounds correctly', () => {
    expect(
      compareJsonSchemas({ type: 'number', exclusiveMinimum: 3 }, { type: 'number', minimum: 2 }),
    ).toBe('compatible')
    expect(
      compareJsonSchemas({ type: 'number', minimum: 3 }, { type: 'number', exclusiveMinimum: 3 }),
    ).toBe('incompatible')
    expect(compareJsonSchemas({ type: 'integer' }, { type: 'number' })).toBe('compatible')
    expect(compareJsonSchemas({ type: 'number' }, { type: 'integer' })).toBe('incompatible')
  })

  it('checks finite strings against length restrictions and ignores inapplicable keywords', () => {
    expect(
      compareJsonSchemas(
        { enum: ['abcd', 'abcde'] },
        { type: 'string', minLength: 3, maxLength: 6 },
      ),
    ).toBe('compatible')
    expect(compareJsonSchemas({ enum: ['abcd', 'a'] }, { type: 'string', minLength: 3 })).toBe(
      'incompatible',
    )
    expect(compareJsonSchemas({ type: 'string' }, { type: 'string', maximum: 5 })).toBe(
      'compatible',
    )
    expect(compareJsonSchemas({ type: 'number' }, { type: 'number', maxLength: 5 })).toBe(
      'compatible',
    )
  })

  it('can prove finite enums fit a union without assuming narrower unions cover broad domains', () => {
    expect(
      compareJsonSchemas({ enum: ['a', 'b'] }, { anyOf: [{ const: 'a' }, { const: 'b' }] }),
    ).toBe('compatible')
    expect(
      compareJsonSchemas(
        { type: 'number' },
        {
          anyOf: [
            { type: 'number', maximum: 0 },
            { type: 'number', minimum: 0 },
          ],
        },
      ),
    ).toBe('unknown')
  })

  it('does not erase unsupported keywords, missing metadata, or $ref', () => {
    expect(compareJsonSchemas({ type: 'string' }, { type: 'string', allOf: [] })).toBe('unknown')
    expect(compareJsonSchemas({ $ref: '#/$defs/input' }, { type: 'string' })).toBe('unknown')
    expect(compareJsonSchemas(undefined, {})).toBe('unknown')
    expect(comparePublishedContracts({}, {}).status).toBe('unknown')
  })

  it('distinguishes strict object changes and tolerates output annotations', () => {
    const produced = {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    }
    expect(compareJsonSchemas(produced, { ...produced, title: 'different' })).toBe('compatible')
    expect(compareJsonSchemas({ ...produced, additionalProperties: true }, produced)).toBe(
      'incompatible',
    )
    expect(compareJsonSchemas(produced, { properties: { id: { type: 'number' } } })).toBe(
      'incompatible',
    )
    expect(
      compareJsonSchemas(
        { type: 'array', items: { type: 'string' } },
        { items: { type: 'number' } },
      ),
    ).toBe('incompatible')
  })
})
