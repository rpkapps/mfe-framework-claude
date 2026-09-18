import { describe, expect, it } from 'vitest'

import { isMfeError, type MfeError } from '@company/mfe-core'

import { normalizeAllowedOrigins } from './origins.ts'

const context = { id: 'shell', operation: 'accept the declared API origins' } as const

/** Asserts the entry is rejected at wiring time and returns the structured error. */
function reject(entry: string): MfeError {
  let thrown: unknown
  try {
    normalizeAllowedOrigins([entry], context)
  } catch (error) {
    thrown = error
  }
  if (!isMfeError(thrown)) throw new Error(`expected ${entry} to be rejected`)
  return thrown
}

describe('normalizeAllowedOrigins', () => {
  it('reduces full URLs to their origin and de-duplicates them', () => {
    const allowlist = normalizeAllowedOrigins(
      [
        'https://api.example.test/v1/',
        'https://api.example.test',
        new URL('https://reports.example.test/daily'),
      ],
      context,
    )

    expect(allowlist.origins).toEqual(['https://api.example.test', 'https://reports.example.test'])
    expect(allowlist.has('https://api.example.test')).toBe(true)
    expect(allowlist.has('https://reports.example.test')).toBe(true)
  })

  it('matches on the exact origin, so scheme, host and port all count', () => {
    const allowlist = normalizeAllowedOrigins(['https://api.example.test'], context)

    expect(allowlist.has('http://api.example.test')).toBe(false)
    expect(allowlist.has('https://api.example.test:8443')).toBe(false)
    expect(allowlist.has('https://evil-api.example.test')).toBe(false)
    expect(allowlist.has('https://api.example.test.evil.test')).toBe(false)
  })

  it('treats an empty declaration as "no origin is an API"', () => {
    const allowlist = normalizeAllowedOrigins([], context)

    expect(allowlist.origins).toEqual([])
    expect(allowlist.has('https://api.example.test')).toBe(false)
  })

  it('rejects a wildcard, because it would hand the bearer token to any matching host', () => {
    expect(reject('https://*.example.test').code).toBe('config/invalid')
    expect(reject('*').message).toContain('List every API origin explicitly')
  })

  it('rejects a relative entry and says an absolute origin is required', () => {
    const error = reject('/api')

    expect(error.code).toBe('config/invalid')
    expect(error.message).toContain('not an absolute URL')
    expect(error.message).toContain('https://api.example.test')
  })

  it('rejects schemes that have no origin a request can be matched against', () => {
    expect(reject('file:///tmp/api').code).toBe('config/invalid')
    expect(reject('wss://api.example.test').message).toContain('http(s)')
  })

  it('rejects an empty entry and points at the unsubstituted variable', () => {
    const error = reject('  ')

    expect(error.message).toContain('an empty string')
    expect(error.message).toContain('environment variable')
  })
})
