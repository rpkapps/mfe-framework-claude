import { describe, expect, it } from 'vitest'

import { collectRoutes, mergeSearch } from './routes.ts'

describe('mergeSearch', () => {
  it('lays the inner route’s params over the outer’s, and keeps both one’s required names', () => {
    expect(
      mergeSearch(
        { type: 'object', properties: { lang: { type: 'string' }, tab: {} }, required: ['lang'] },
        { type: 'object', properties: { tab: { type: 'string' } }, required: ['tab'] },
      ),
    ).toEqual({
      type: 'object',
      properties: { lang: { type: 'string' }, tab: { type: 'string' } },
      required: ['lang', 'tab'],
    })
  })

  it('keeps a closed schema closed, and passes one side through when the other is absent', () => {
    const closed = { type: 'object', properties: {}, additionalProperties: false }

    expect(mergeSearch(closed, { type: 'object', properties: {} })).toMatchObject({
      additionalProperties: false,
    })
    expect(mergeSearch(undefined, closed)).toBe(closed)
    expect(mergeSearch(closed, undefined)).toBe(closed)
  })
})

describe('collectRoutes', () => {
  it('keeps one entry per path, sorted, merging the search params of routes that share one', () => {
    expect(
      collectRoutes([
        { path: '/wells/:wellId' },
        { path: '/wells' },
        { path: '/wells', search: { type: 'object', properties: { status: {} } } },
        { path: '/' },
      ]),
    ).toEqual([
      { path: '/' },
      { path: '/wells', search: { type: 'object', properties: { status: {} } } },
      { path: '/wells/:wellId' },
    ])
  })
})
