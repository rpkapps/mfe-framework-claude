import { describe, expect, it } from 'vitest'

import { isMfeError } from './errors.ts'
import {
  assertRuntimeCompatibility,
  isRuntimeRequirement,
  satisfiesRuntimeRequirement,
} from './runtime-compatibility.ts'

describe('runtime API compatibility', () => {
  it.each([
    ['1.4.0', '>=1.3.0 <2.0.0', true],
    ['1.2.0', '>=1.3.0 <2.0.0', false],
    ['2.0.0', '>=1.3.0 <2.0.0', false],
    ['1.10.0', '>=1.9.0 <2.0.0', true],
    ['1.3.0+build.7', '=1.3.0', true],
    ['1.3.1', '1.3.0', false],
    ['1.3.0', '>1.3.0', false],
    ['1.3.0', '<=1.3.0', true],
    ['1.3.0', '>=1.4.0 <1.0.0', false],
    ['1.3.0-beta.1', '>=1.0.0 <2.0.0', false],
    ['01.3.0', '>=1.0.0 <2.0.0', false],
  ])('compares %s against %s as %s', (version, range, expected) => {
    expect(satisfiesRuntimeRequirement(version, range)).toBe(expected)
  })

  it.each([
    '',
    '*',
    '^1.0.0',
    '1.x',
    '>= 1.0.0',
    '1.0.0 || 2.0.0',
    '>=1.0.0-rc.1',
    '01.0.0',
    '1.0.0+',
  ])('rejects unsupported/malformed metadata %s', range => {
    expect(isRuntimeRequirement(range)).toBe(false)
    expect(satisfiesRuntimeRequirement('1.1.0', range)).toBe(false)
  })

  it('accepts legacy entries against a compatible current shell', () => {
    expect(() =>
      assertRuntimeCompatibility({ apiVersion: '1.1.0' }, { id: 'old-app' }),
    ).not.toThrow()
    expect(() => assertRuntimeCompatibility({}, { id: 'old-app' })).not.toThrow()
    expect(() => assertRuntimeCompatibility({ apiVersion: '2.0.0' }, { id: 'old-app' })).toThrow()
  })

  it('gives an old shell without apiVersion an actionable new-adapter failure', () => {
    try {
      assertRuntimeCompatibility(
        {},
        { id: 'new-app', version: '7.2.0', requiresRuntime: '>=1.1.0 <2.0.0' },
      )
      throw new Error('expected incompatible runtime')
    } catch (error) {
      expect(isMfeError(error)).toBe(true)
      expect(error).toMatchObject({
        code: 'contract/runtime-incompatible',
        id: 'new-app',
        definitionVersion: '7.2.0',
      })
      expect((error as Error).message).toContain('runtime API 1.0.0')
      expect((error as Error).message).toContain('Reload after the shell is upgraded')
    }
  })
})
