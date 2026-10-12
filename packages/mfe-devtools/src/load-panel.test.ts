import { afterEach, describe, expect, it, vi } from 'vitest'

import { forgetPanel, loadPanel } from './load-panel.ts'

afterEach(() => {
  vi.doUnmock('./panel/devtools-panel.tsx')
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

  it('fetches again after a load that failed', async () => {
    vi.resetModules()
    vi.doMock('./panel/devtools-panel.tsx', () => {
      throw new TypeError('Failed to fetch dynamically imported module')
    })
    const fresh = await import('./load-panel.ts')
    const failed = fresh.loadPanel()
    await expect(failed).rejects.toThrow()

    expect(fresh.loadPanel()).not.toBe(failed)
  })

  // That the specifier resolves to a real component is left to the shell's build and
  // `pnpm verify:page`, which establish it in the environment that actually loads the chunk.
})
