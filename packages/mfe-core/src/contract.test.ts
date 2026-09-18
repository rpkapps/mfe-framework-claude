import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  eventNameToHandlerProp,
  findNonSerializableValue,
  isReservedInputName,
  isValidEventName,
  validateAgainstContract,
  validateSerializable,
  type ContractSchema,
  type ContractValidationContext,
} from './contract.ts'

const inputContext: ContractValidationContext = {
  id: 'alert-panel',
  definitionVersion: '1.4.0',
  direction: 'input',
  side: 'provider',
}

describe('validateAgainstContract', () => {
  it('accepts a valid payload and returns the parsed value', () => {
    const schema = z.object({ alertId: z.string() }) as unknown as ContractSchema<{
      alertId: string
    }>

    const result = validateAgainstContract(schema, { alertId: 'a-1' }, inputContext)

    expect(result).toEqual({ ok: true, value: { alertId: 'a-1' } })
  })

  it('produces an actionable diagnostic for a missing field', () => {
    const schema = z.object({ alertId: z.string() }) as unknown as ContractSchema<{
      alertId: string
    }>

    const result = validateAgainstContract(schema, {}, {
      ...inputContext,
      note: 'The previous valid inputs remain displayed.',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error.code).toBe('contract/input-mismatch')
    expect(result.error.direction).toBe('input')
    expect(result.error.path).toEqual(['alertId'])
    expect(result.error.message).toContain('alert-panel@1.4.0')
    expect(result.error.message).toContain('alertId')
    expect(result.error.message).toContain('received undefined')
    expect(result.error.message).toContain('The Widget provider declares this expectation.')
    expect(result.error.message).toContain('Check the alertId prop in the consuming component.')
    expect(result.error.message).toContain('The previous valid inputs remain displayed.')
  })

  it('attributes a consumer-side event failure to the consumer contract', () => {
    const schema = z.object({ alertId: z.string() }) as unknown as ContractSchema<{
      alertId: string
    }>

    const result = validateAgainstContract(schema, { alertId: 42 }, {
      id: 'alert-panel',
      direction: 'event',
      side: 'consumer',
      eventName: 'acknowledged',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('contract/event-mismatch')
    expect(result.error.message).toContain("emit event 'acknowledged'")
    expect(result.error.message).toContain('the runtime contract it supplied')
    expect(result.error.message).toContain("Check the 'acknowledged' schema")
  })

  it('strips unknown keys so a provider adding a field does not break consumers (tolerant readers)', () => {
    const consumerContract = z.object({ alertId: z.string() }) as unknown as ContractSchema<{
      alertId: string
    }>

    const result = validateAgainstContract(
      consumerContract,
      { alertId: 'a-1', severity: 'high', addedLater: true },
      { id: 'alert-panel', direction: 'event', side: 'consumer', eventName: 'acknowledged' },
    )

    expect(result).toEqual({ ok: true, value: { alertId: 'a-1' } })
  })

  it('reports a nested field path the way an author would write it', () => {
    const schema = z.object({
      filters: z.array(z.object({ value: z.string() })),
    }) as unknown as ContractSchema<{ filters: { value: string }[] }>

    const result = validateAgainstContract(schema, { filters: [{ value: 9 }] }, inputContext)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.path).toEqual(['filters', 0, 'value'])
    expect(result.error.message).toContain('filters[0].value')
  })
})

describe('serializable values only', () => {
  it.each([
    ['a function', { onSelect: () => {} }, 'a function'],
    ['a Date', { at: new Date() }, 'a Date'],
    ['a Map', { m: new Map() }, 'a Map'],
    ['a Set', { s: new Set() }, 'a Set'],
    ['a class instance', { c: new (class Thing {})() }, 'a Thing instance'],
    ['a bigint', { big: 1n }, 'a bigint'],
    ['a non-finite number', { n: Number.NaN }, 'NaN'],
  ])('rejects %s', (_label, value, expected) => {
    const found = findNonSerializableValue(value)
    expect(found?.description).toContain(expected)
  })

  it('accepts plain JSON data', () => {
    expect(
      findNonSerializableValue({
        alertId: 'a-1',
        count: 3,
        nested: { flag: true, items: ['x', null] },
      }),
    ).toBeNull()
  })

  it('reports a circular reference rather than recursing forever', () => {
    const cyclic: Record<string, unknown> = { name: 'root' }
    cyclic['self'] = cyclic

    expect(findNonSerializableValue(cyclic)?.description).toBe('a circular reference')
  })

  it('turns a non-serializable value into a structured error naming the repair', () => {
    const error = validateSerializable({ onSelect: () => {} }, inputContext)

    expect(error?.code).toBe('contract/input-mismatch')
    expect(error?.path).toEqual(['onSelect'])
    expect(error?.message).toContain('expected a JSON-serializable value')
    expect(error?.message).toContain('subscribes to an event instead')
  })

  it('allows an absent optional field but not a hole inside an array', () => {
    expect(findNonSerializableValue({ optional: undefined })).toBeNull()
    expect(findNonSerializableValue([undefined])?.description).toBe('undefined inside an array')
  })
})

describe('reserved names', () => {
  it.each(['key', 'ref', 'fallback', 'onAcknowledged', 'onX'])('reserves %s', name => {
    expect(isReservedInputName(name)).toBe(true)
  })

  it.each(['alertId', 'online', 'once', 'on'])('allows %s as an input name', name => {
    expect(isReservedInputName(name)).toBe(false)
  })

  it('maps an event name to its handler prop', () => {
    expect(eventNameToHandlerProp('acknowledged')).toBe('onAcknowledged')
    expect(eventNameToHandlerProp('selectionChanged')).toBe('onSelectionChanged')
  })

  it('requires lower-camel-case event names', () => {
    expect(isValidEventName('acknowledged')).toBe(true)
    expect(isValidEventName('selectionChanged')).toBe(true)
    expect(isValidEventName('Acknowledged')).toBe(false)
    expect(isValidEventName('selection-changed')).toBe(false)
  })
})
