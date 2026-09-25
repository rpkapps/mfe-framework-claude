import { createMemoryRuntime, type MemoryRuntime } from '@company/mfe-react/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { routerNavigation, type NavigatingRouter } from './navigation.ts'

let memory: MemoryRuntime

beforeEach(() => {
  memory = createMemoryRuntime({ initialEntries: ['/operations/wells'] })
})

afterEach(() => {
  memory.dispose()
})

/** A router that lands where it is sent, with the trailing slash TanStack trims. */
function router(): NavigatingRouter & { readonly navigate: ReturnType<typeof vi.fn> } {
  const location = { pathname: '/operations/wells', href: '/operations/wells' }
  return {
    state: { location },
    navigate: vi.fn(({ href }: { readonly href: string }) => {
      location.href = href.replace(/\/(?=$|\?)/, '')
      location.pathname = location.href.split('?')[0] ?? location.href
      return Promise.resolve()
    }),
  }
}

describe('routerNavigation', () => {
  it('goes past the blocker it already asked, and answers where the router landed', async () => {
    const shell = router()
    const go = routerNavigation(shell, memory.runtime)

    expect(await go('/operations/wells/W-1/')).toBe('/operations/wells/W-1')
    expect(shell.navigate).toHaveBeenCalledWith({
      href: '/operations/wells/W-1/',
      ignoreBlocker: true,
    })
  })

  it('answers undefined, without navigating, when a mounted App holds the page', async () => {
    const confirm = vi.fn(() => Promise.resolve('reset' as const))
    memory.runtime.navigator.registerBlocker('mount-1', {
      depth: 1,
      shouldBlock: () => true,
      confirm,
    })
    const shell = router()

    expect(await routerNavigation(shell, memory.runtime)('/dashboard')).toBeUndefined()
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.objectContaining({ pathname: '/operations/wells' }) as unknown,
        to: expect.objectContaining({ pathname: '/dashboard' }) as unknown,
        leavesBoundary: true,
      }),
    )
    expect(shell.navigate).not.toHaveBeenCalled()
  })
})
