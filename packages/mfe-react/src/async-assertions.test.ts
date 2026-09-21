/**
 * A guard on the test setup: the CJS `@testing-library/jest-dom/vitest` entry extends a second
 * vitest instance and empties every `rejects.toThrow` message, so the setup avoids that entry.
 */

import { describe, expect, it } from 'vitest'

const boom = (): Promise<never> => Promise.reject(new Error('plain boom'))

describe('asserting on a rejection', () => {
  it('matches with rejects.toThrowError', async () => {
    await expect(boom()).rejects.toThrowError(/plain boom/)
  })

  it('matches with rejects.toThrow', async () => {
    await expect(boom()).rejects.toThrow(/plain boom/)
  })

  it('still has jest-dom matchers available', () => {
    const element = document.createElement('div')
    document.body.append(element)
    expect(element).toBeInTheDocument()
  })
})
