import { describe, expect, it } from 'vitest'

import { createMfeError, describeValue, formatPath, isMfeError, toMfeError } from './errors.ts'

describe('createMfeError message composition', () => {
  it('names the definition, field, expectation, observation and repair step', () => {
    const error = createMfeError({
      code: 'contract/input-mismatch',
      id: 'alert-panel',
      operation: 'accept input',
      direction: 'input',
      path: ['alertId'],
      expected: 'a string',
      observed: 'undefined',
      repair: 'Check the alertId prop in the consuming component.',
    })

    expect(error.message).toBe(
      'alert-panel failed to accept input alertId: expected a string, received undefined. ' +
        'Check the alertId prop in the consuming component.',
    )
  })

  it('includes the definition version so a failure identifies which build was running', () => {
    const error = createMfeError({
      code: 'mount/failure',
      id: 'operations',
      definitionVersion: '2.1.0',
      operation: 'mount',
      observed: 'the render function threw',
    })

    expect(error.message).toContain('operations@2.1.0')
  })

  it('carries structured fields for exhaustive host handling', () => {
    const cause = new Error('underlying')
    const error = createMfeError({
      code: 'contract/output-mismatch',
      id: 'alert-panel',
      definitionVersion: '1.4.0',
      operation: "emit output 'acknowledged'",
      direction: 'output',
      path: ['alertId'],
      cause,
    })

    expect(error.code).toBe('contract/output-mismatch')
    expect(error.id).toBe('alert-panel')
    expect(error.definitionVersion).toBe('1.4.0')
    expect(error.direction).toBe('output')
    expect(error.path).toEqual(['alertId'])
    expect(error.cause).toBe(cause)
    expect(isMfeError(error)).toBe(true)
  })
})

describe('formatPath', () => {
  it('renders nested object and array access the way an author would write it', () => {
    expect(formatPath(['filters', 0, 'value'])).toBe('filters[0].value')
    expect(formatPath([])).toBe('')
    expect(formatPath(undefined)).toBe('')
  })
})

describe('describeValue', () => {
  it('describes shapes rather than dumping payloads', () => {
    expect(describeValue({ secret: 'token' })).toBe('an object')
    expect(describeValue([1, 2, 3])).toBe('an array of length 3')
    expect(describeValue('x'.repeat(50))).toBe('a string of length 50')
    expect(describeValue(new Date())).toBe('a Date')
    expect(describeValue(undefined)).toBe('undefined')
    expect(describeValue(null)).toBe('null')
    expect(describeValue(7)).toBe('7')
  })

  it('quotes short strings so the exact value is visible', () => {
    expect(describeValue('ready')).toBe('"ready"')
  })
})

describe('toMfeError', () => {
  it('returns an existing structured error unchanged', () => {
    const original = createMfeError({ code: 'load/timeout', id: 'reports', operation: 'load' })
    expect(toMfeError(original, { code: 'mount/failure', id: 'reports', operation: 'mount' })).toBe(
      original,
    )
  })

  it('wraps a thrown non-error while preserving the original cause', () => {
    const error = toMfeError('boom', {
      code: 'mount/failure',
      id: 'reports',
      operation: 'mount',
    })

    expect(error.code).toBe('mount/failure')
    expect(error.cause).toBe('boom')
    expect(error.message).toContain('"boom"')
  })

  it('uses an Error name and message as the observation', () => {
    const error = toMfeError(new TypeError('bad shape'), {
      code: 'load/entry-failure',
      id: 'reports',
      operation: 'load entry',
    })

    expect(error.message).toContain('TypeError: bad shape')
  })
})
