import { describe, expect, it } from 'vitest'

import { currentReturnTo, isSigninCallback, safeReturnTo } from './return-to.ts'

const origin = 'https://discovery.example.com'

describe('safeReturnTo', () => {
  it('keeps a path on this origin with its query and hash', () => {
    expect(safeReturnTo('/operations/wells?sort=depth#top', origin)).toBe(
      '/operations/wells?sort=depth#top',
    )
  })

  it.each([
    ['another origin', 'https://attacker.example/'],
    ['a protocol-relative URL', '//attacker.example/path'],
    ['a backslash host', '/\\attacker.example'],
    ['a relative path', 'operations'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['something that is not a string', { path: '/operations' }],
    ['nothing', undefined],
  ])('falls back to the dashboard for %s', (_label, value) => {
    expect(safeReturnTo(value, origin)).toBe('/')
  })
})

describe('currentReturnTo', () => {
  it('is the path, query and hash of the location', () => {
    expect(currentReturnTo({ pathname: '/reports', search: '?q=1', hash: '#a' })).toBe(
      '/reports?q=1#a',
    )
  })
})

describe('isSigninCallback', () => {
  it('recognises a code or an error with state at the root', () => {
    expect(isSigninCallback(new URL(`${origin}/?code=abc&state=xyz`))).toBe(true)
    expect(isSigninCallback(new URL(`${origin}/?error=access_denied&state=xyz`))).toBe(true)
  })

  it('ignores the same parameters below an App boundary, and a root without state', () => {
    expect(isSigninCallback(new URL(`${origin}/reports?code=abc&state=xyz`))).toBe(false)
    expect(isSigninCallback(new URL(`${origin}/?code=abc`))).toBe(false)
  })
})
