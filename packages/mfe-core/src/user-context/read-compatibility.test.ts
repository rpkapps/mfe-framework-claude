import { describe, expect, it } from 'vitest'
import { stateCapabilities, userContextReadCapabilities, type StateNode } from './index.ts'

const capabilities = (node: StateNode) => userContextReadCapabilities(stateCapabilities(node))
const object = (fields: Record<string, StateNode>, strict = true): StateNode => ({
  kind: 'object',
  strict,
  fields,
})
const compatible = (owner: StateNode, reader: StateNode) => {
  const available = new Set(capabilities(owner))
  return capabilities(reader).every(value => available.has(value))
}

describe('foreign user-context read compatibility', () => {
  it('accepts nested subsets without copying owner defaults or object strictness', () => {
    const owner = object({
      selection: {
        kind: 'default',
        value: { wellId: null, revision: 1 },
        inner: object({
          wellId: { kind: 'nullable', inner: { kind: 'string' } },
          revision: { kind: 'number' },
        }),
      },
      hidden: { kind: 'boolean' },
    })
    const reader = object(
      {
        selection: object(
          {
            wellId: { kind: 'nullable', inner: { kind: 'string' } },
          },
          false,
        ),
      },
      false,
    )
    expect(compatible(owner, reader)).toBe(true)
    expect(stateCapabilities(reader).every(value => stateCapabilities(owner).includes(value))).toBe(
      false,
    )
  })

  it('never erases optional or nullable owner values for a required consumer', () => {
    const required = object({ value: { kind: 'string' } })
    expect(
      compatible(object({ value: { kind: 'optional', inner: { kind: 'string' } } }), required),
    ).toBe(false)
    expect(
      compatible(object({ value: { kind: 'nullable', inner: { kind: 'string' } } }), required),
    ).toBe(false)
    expect(compatible(object({ other: { kind: 'string' } }), required)).toBe(false)
  })

  it('normalizes nested defaults without confusing escaped field names with wrapper paths', () => {
    const value: StateNode = { kind: 'string' }
    const owner = object({
      '/i': {
        kind: 'default',
        value: { i: 'ready' },
        inner: object({ i: { kind: 'default', value: 'ready', inner: value } }),
      },
    })
    expect(compatible(owner, object({ '/i': object({ i: value }, false) }, false))).toBe(true)
    expect(compatible(owner, object({ i: object({ i: value }) }))).toBe(false)
  })

  it('retains type and value constraint checks', () => {
    expect(
      compatible(object({ value: { kind: 'string' } }), object({ value: { kind: 'number' } })),
    ).toBe(false)
    expect(
      compatible(
        object({ value: { kind: 'string' } }),
        object({ value: { kind: 'string', min: 1 } }),
      ),
    ).toBe(false)
  })
})
