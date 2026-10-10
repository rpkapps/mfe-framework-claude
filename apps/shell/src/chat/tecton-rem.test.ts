// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { tectonRemInPixels } from './tecton-rem.ts'

describe('tectonRemInPixels', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.style.fontSize = ''
  })

  it('measures --tecton-rem, not the root font size, and leaves nothing behind', () => {
    // A shell shrinking the root to 14px for PrimeNG, with Tecton's rem set back to 16px.
    document.documentElement.style.fontSize = '14px'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return new DOMRect(0, 0, this.style.width === 'var(--tecton-rem, 1rem)' ? 16 : 14, 0)
    })

    expect(tectonRemInPixels()).toBe(16)
    expect(document.body.childElementCount).toBe(0)
  })

  it('falls back to 16px where nothing is laid out', () => {
    expect(tectonRemInPixels()).toBe(16)
  })
})
