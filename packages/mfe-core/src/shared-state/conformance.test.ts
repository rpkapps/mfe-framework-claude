import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  applyStateWrite,
  assertJson,
  normalize,
  type StateContract,
  type StateNode,
} from './index.ts'

const text: StateNode = { kind: 'string' }
const optional = (inner: StateNode): StateNode => ({ kind: 'optional', inner })
const nullable = (inner: StateNode): StateNode => ({ kind: 'nullable', inner })
const object = (fields: Record<string, StateNode>): StateNode => ({
  kind: 'object',
  fields,
  strict: true,
})
const contract = (node: StateNode): StateContract => ({
  formatVersion: 1,
  id: 'selection',
  revision: 'fixture',
  node,
})
const old = contract(
  nullable(
    object({
      well: text,
      note: optional(text),
      details: optional(nullable(object({ run: text, label: optional(text) }))),
      items: { kind: 'array', item: text },
      units: { kind: 'default', inner: text, value: 'metric' },
    }),
  ),
)
const next = contract(
  nullable(
    object({
      ...(old.node as { inner: Extract<StateNode, { kind: 'object' }> }).inner.fields,
      comparison: optional(text),
      details: optional(
        nullable(object({ run: text, label: optional(text), mode: optional(text) })),
      ),
    }),
  ),
)
const current = {
  well: 'well-42',
  note: 'remove',
  comparison: 'baseline',
  details: { run: 'run-7', label: 'remove', mode: 'overlay' },
  items: ['one', 'two'],
  units: 'imperial',
}

// Executable protocol fixtures, shared semantics browser and backend call through applyStateWrite.
const fixtures = [
  {
    name: 'merges objects recursively without deleting any omitted fields',
    supplied: { well: 'well-43', details: { run: 'run-8' }, items: ['three'] },
    expected: {
      well: 'well-43',
      note: 'remove',
      comparison: 'baseline',
      details: { run: 'run-8', label: 'remove', mode: 'overlay' },
      items: ['three'],
      units: 'imperial',
    },
  },
  {
    name: 'explicit nested null clears newer descendants',
    supplied: { well: 'well-42', details: null, items: [] },
    expected: {
      well: 'well-42',
      note: 'remove',
      comparison: 'baseline',
      details: null,
      items: [],
      units: 'imperial',
    },
  },
  {
    name: 'omitted optional object and defaults are preserved',
    supplied: { well: 'well-42', items: [] },
    expected: { ...current, items: [] },
  },
  { name: 'null clears the complete state', supplied: null, expected: null },
]
describe('shared-state wire conformance', () => {
  for (const fixture of fixtures)
    it(fixture.name, () =>
      expect(applyStateWrite(next, current, fixture.supplied)).toEqual(fixture.expected),
    )
  it('projects before strict validation and never mutates canonical reads', () => {
    const before = structuredClone(current)
    const view = normalize(old.node, current, old.id, true)
    expect(view).toEqual({
      well: 'well-42',
      note: 'remove',
      details: { run: 'run-7', label: 'remove' },
      items: ['one', 'two'],
      units: 'imperial',
    })
    expect(current).toEqual(before)
    expect(() => normalize(old.node, current, old.id)).toThrow('no undeclared properties')
  })
  it('matches supported Zod validation and materialized output', () => {
    const schema = z
      .strictObject({
        well: z.string(),
        note: z.string().optional(),
        details: z
          .strictObject({ run: z.string(), label: z.string().optional() })
          .nullable()
          .optional(),
        items: z.array(z.string()),
        units: z.string().default('metric'),
      })
      .nullable()
    for (const fixture of fixtures)
      expect(normalize(old.node, fixture.supplied, old.id)).toEqual(schema.parse(fixture.supplied))
    for (const invalid of [
      { well: 1, items: [] },
      { well: '42', items: [4] },
      { well: '42', items: [], surprise: true },
    ]) {
      expect(schema.safeParse(invalid).success).toBe(false)
      expect(() => normalize(old.node, invalid, old.id)).toThrow()
    }
  })
  it('rejects lossy JSON, cycles, class values, holes and symbol keys', () => {
    const cycle: Record<string, unknown> = {}
    cycle['self'] = cycle
    for (const value of [
      NaN,
      Infinity,
      undefined,
      new Date(),
      cycle,
      Array(1),
      { [Symbol('private')]: 1 },
      { field: undefined },
    ])
      expect(() => assertJson(value)).toThrow()
  })
  it('treats prototype-like keys as ordinary fields', () => {
    const shape = JSON.parse(
      '{"__proto__":{"kind":"string"},"constructor":{"kind":"string"}}',
    ) as Record<string, StateNode>
    const value: unknown = JSON.parse('{"__proto__":"data","constructor":"data"}')
    expect(normalize(object(shape), value, 'safe')).toEqual(value)
    expect(Object.getPrototypeOf(normalize(object(shape), value, 'safe'))).toBe(Object.prototype)
  })
})
