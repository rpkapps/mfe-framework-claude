import { describe, expect, it } from 'vitest'
import { assertJson, mergeStateValue, type Json } from './index.ts'

const current = {
  well: 'well-42',
  note: 'keep',
  comparison: 'baseline',
  details: { run: 'run-7', label: 'keep', mode: 'overlay' },
  items: ['one', 'two'],
  units: 'imperial',
}

// The merge the reference backend applies to every write, and the store validates before sending.
const fixtures: readonly { name: string; supplied: Json; expected: Json }[] = [
  {
    name: 'merges objects recursively without deleting any omitted fields',
    supplied: { well: 'well-43', details: { run: 'run-8' }, items: ['three'] },
    expected: {
      ...current,
      well: 'well-43',
      details: { run: 'run-8', label: 'keep', mode: 'overlay' },
      items: ['three'],
    },
  },
  {
    name: 'explicit nested null clears its descendants',
    supplied: { details: null, items: [] },
    expected: { ...current, details: null, items: [] },
  },
  { name: 'null replaces the complete value', supplied: null, expected: null },
]
describe('user-context wire conformance', () => {
  for (const fixture of fixtures)
    it(fixture.name, () => {
      const before = structuredClone(current)
      expect(mergeStateValue(current, fixture.supplied)).toEqual(fixture.expected)
      expect(current).toEqual(before)
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
    const value = JSON.parse('{"__proto__":"data","constructor":"data"}') as Json
    const merged = mergeStateValue({}, value)
    expect(merged).toEqual(value)
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
  })
})
