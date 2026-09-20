/**
 * The one invariant the loader exists for.
 *
 * `use` suspends again on any promise it has not already seen, so a loader that
 * built a fresh one per call would suspend forever and refetch as fast as the
 * network allowed. The memo is the fix, and it is invisible until it is gone.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { forgetPanel, loadPanel } from './load-panel.ts'

afterEach(() => {
  forgetPanel()
})

describe('loading the panel chunk', () => {
  it('hands back the same promise every time, so use() settles', () => {
    expect(loadPanel()).toBe(loadPanel())
  })

  it('fetches again after the cached module is forgotten', () => {
    const first = loadPanel()
    forgetPanel()

    expect(loadPanel()).not.toBe(first)
  })

  /*
   * That the specifier resolves to a real component is not asserted here: it
   * pulls the whole design system through jsdom for a fact the shell's build
   * and `pnpm verify:page` both establish properly, in the environment that
   * actually loads the chunk.
   */
})
