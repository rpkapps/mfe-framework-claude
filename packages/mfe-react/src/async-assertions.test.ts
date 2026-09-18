/**
 * A guard on the test setup itself.
 *
 * Asserting on a rejection is the normal way to test a framework error, and
 * `@testing-library/jest-dom/vitest` silently breaks it: that entry is CJS and
 * extends a second vitest instance, after which every `rejects.toThrow` reports
 * an empty message — including for a plain Error, so the failure looks like a
 * bug in the code under test. vitest.setup.ts imports the matchers directly to
 * avoid it, and this fails if anyone puts the convenient entry back.
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
