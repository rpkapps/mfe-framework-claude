import { describe, expect, it } from 'vitest'

import { MAX_SELECTION_LENGTH, quote, splitQuote } from './quote.ts'

describe('quote', () => {
  it('quotes every line, and clips a long selection', () => {
    expect(quote('  one\ntwo ')).toBe('> one\n> two')
    expect(quote('x'.repeat(MAX_SELECTION_LENGTH + 5))).toBe(
      `> ${'x'.repeat(MAX_SELECTION_LENGTH)}…`,
    )
  })

  it('is split back into the quote and what the user wrote', () => {
    expect(splitQuote(`${quote('A-7 is flaring')}\n\nWhy?`)).toEqual({
      quoted: 'A-7 is flaring',
      rest: 'Why?',
    })
    expect(splitQuote('No quote')).toEqual({ quoted: '', rest: 'No quote' })
  })
})
