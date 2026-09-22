/**
 * The brand is how a host recognises a definition from any adapter, so it has to survive a second
 * copy of the module and still refuse a record that merely looks similar.
 */

import { describe, expect, it } from 'vitest'

import { DEFINITION_BRAND, isBrandedDefinition } from './definition-brand.ts'

function definition(overrides: Record<PropertyKey, unknown> = {}): Record<PropertyKey, unknown> {
  return {
    [DEFINITION_BRAND]: true,
    kind: 'widget',
    id: 'alert-panel',
    framework: 'angular',
    ...overrides,
  }
}

describe('isBrandedDefinition', () => {
  it('recognises a definition from either adapter', () => {
    expect(isBrandedDefinition(definition({ framework: 'react' }))).toBe(true)
    expect(isBrandedDefinition(definition({ framework: 'angular', kind: 'app' }))).toBe(true)
  })

  /** A container can evaluate its own copy of an adapter, and its definitions still count. */
  it('recognises the brand by its registered name rather than by module identity', () => {
    const fromAnotherCopy = {
      [Symbol.for('@company/mfe.definition')]: true,
      kind: 'app',
      id: 'reports',
      framework: 'react',
    }

    expect(isBrandedDefinition(fromAnotherCopy)).toBe(true)
  })

  it('refuses a record without the brand, however much else matches', () => {
    const unbranded = definition()
    delete unbranded[DEFINITION_BRAND]

    expect(isBrandedDefinition(unbranded)).toBe(false)
    expect(isBrandedDefinition(definition({ [DEFINITION_BRAND]: 'yes' }))).toBe(false)
  })

  it('refuses a branded record that names no adapter it knows', () => {
    expect(isBrandedDefinition(definition({ framework: undefined }))).toBe(false)
    expect(isBrandedDefinition(definition({ framework: 'vue' }))).toBe(false)
  })

  it('refuses a branded record with no usable identity or kind', () => {
    expect(isBrandedDefinition(definition({ id: 7 }))).toBe(false)
    expect(isBrandedDefinition(definition({ kind: 'page' }))).toBe(false)
  })

  it('refuses values that are not records', () => {
    expect(isBrandedDefinition(null)).toBe(false)
    expect(isBrandedDefinition('alert-panel')).toBe(false)
    expect(isBrandedDefinition(undefined)).toBe(false)
  })
})
