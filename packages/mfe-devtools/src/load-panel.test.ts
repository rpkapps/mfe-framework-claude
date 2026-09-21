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

  // That the specifier resolves to a real component is left to the shell's build and
  // `pnpm verify:page`, which establish it in the environment that actually loads the chunk.
})
