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

  it('accepts explicit requirements against a compatible current shell', () => {
    expect(() =>
      assertRuntimeCompatibility(
        { apiVersion: '1.1.0' },
        { id: 'reports', requiresRuntime: '>=1.1.0 <2.0.0' },
      ),
    ).not.toThrow()
  })

  it.each([undefined, null, '', '^1.1.0', 1])(
    'rejects missing or malformed requirement metadata %s without inventing a baseline',
    requiresRuntime => {
      expect(() =>
        assertRuntimeCompatibility({ apiVersion: '1.1.0' }, { id: 'reports', requiresRuntime }),
      ).toThrow(
        expect.objectContaining({ code: 'registry/invalid-entry', path: ['requiresRuntime'] }),
      )
    },
  )

  it.each([null, '', '1.1', '1.1.0-beta.1', 1])(
    'rejects malformed shell apiVersion %s',
    apiVersion => {
      expect(() =>
        assertRuntimeCompatibility(
          { apiVersion },
          { id: 'reports', requiresRuntime: '>=1.1.0 <2.0.0' },
        ),
      ).toThrow(expect.objectContaining({ code: 'config/invalid', path: ['apiVersion'] }))
    },
  )

  it('gives a shell without apiVersion an actionable metadata failure', () => {
    try {
      assertRuntimeCompatibility(
        {},
        { id: 'new-app', version: '7.2.0', requiresRuntime: '>=1.1.0 <2.0.0' },
      )
      throw new Error('expected missing runtime metadata')
    } catch (error) {
      expect(isMfeError(error)).toBe(true)
      expect(error).toMatchObject({
        code: 'config/missing',
        id: 'new-app',
        definitionVersion: '7.2.0',
        path: ['apiVersion'],
      })
      expect((error as Error).message).toContain('no apiVersion')
      expect((error as Error).message).toContain('createMfeRuntime')
    }
  })
})
