// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Failure } from './failure/failure-page.tsx'
import { revealShell } from './loader.ts'
import type * as Loader from './loader.ts'

function screen(holdFor?: number): HTMLElement {
  document.body.innerHTML = '<div id="shell-loader" data-state="loading"></div>'
  const loader = document.getElementById('shell-loader') as HTMLElement
  if (holdFor !== undefined) {
    loader.dataset['holdUntil'] = String(performance.now() + holdFor)
  }
  return loader
}

describe('revealShell', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Reduced motion, so the loader is removed at once rather than after its fade.
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    delete document.documentElement.dataset['shell']
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reveals the shell at once when the loader asked for no minimum', () => {
    const loader = screen()
    revealShell()
    expect(document.documentElement.dataset['shell']).toBe('ready')
    expect(loader.isConnected).toBe(false)
  })

  it('keeps the loader up until its minimum time on screen has passed', () => {
    const loader = screen(1000)
    revealShell()
    revealShell()
    expect(document.documentElement.dataset['shell']).toBeUndefined()
    expect(loader.dataset['state']).toBe('holding')

    vi.advanceTimersByTime(999)
    expect(document.documentElement.dataset['shell']).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(document.documentElement.dataset['shell']).toBe('ready')
    expect(loader.isConnected).toBe(false)
  })

  it('does not wait for a minimum that has already passed', () => {
    screen(-50)
    revealShell()
    expect(document.documentElement.dataset['shell']).toBe('ready')
  })
})

const SIGN_IN: Failure = {
  kind: 'sign-in',
  title: 'We could not sign you in',
  detail: 'No matching state found in storage',
  actionLabel: 'Sign in again',
  pendingLabel: 'Redirecting…',
  onAction: vi.fn(),
}

const UNREACHABLE: Failure = {
  kind: 'unreachable',
  title: 'The sign-in service is unreachable',
  detail: 'Failed to fetch',
  actionLabel: 'Try again',
  onAction: vi.fn(),
}

/** The loader as index.html has it, words and all. */
function loaderWithWords(): HTMLElement {
  document.body.innerHTML = `<div id="shell-loader" data-state="loading">
    <p data-part="status">Loading…</p><p data-part="detail"></p>
    <button data-part="action" type="button" hidden></button>
  </div>`
  return document.getElementById('shell-loader') as HTMLElement
}

function part(name: string): HTMLElement {
  return document.querySelector(`[data-part="${name}"]`) as HTMLElement
}

const showFailure = vi.fn<(failure: Failure) => void>()

/** A fresh `loader.ts`, whose failure page loads or, on a network that is gone, does not. */
async function loaderModule(pageLoads = true): Promise<typeof Loader> {
  vi.resetModules()
  vi.doMock('./failure/show.tsx', () => {
    if (!pageLoads) throw new Error('Failed to fetch dynamically imported module')
    return { showFailure }
  })
  return await import('./loader.ts')
}

describe('failLoader', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    delete document.documentElement.dataset['shell']
    showFailure.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the failure page, and a later failure over it', async () => {
    const { failLoader } = await loaderModule()
    const loader = loaderWithWords()
    failLoader(SIGN_IN)
    expect(loader.dataset['state']).toBe('failing')
    expect(part('status').textContent).toBe('We could not sign you in')
    await vi.waitFor(() => {
      expect(showFailure).toHaveBeenCalledWith(SIGN_IN)
    })

    // The page has replaced the loader by the time its action is pressed.
    loader.remove()
    failLoader(UNREACHABLE)
    await vi.waitFor(() => {
      expect(showFailure).toHaveBeenLastCalledWith(UNREACHABLE)
    })
  })

  it('leaves a shell that is on its way in alone', async () => {
    const { failLoader } = await loaderModule()
    const loader = loaderWithWords()
    loader.dataset['state'] = 'holding'
    failLoader(SIGN_IN)
    document.documentElement.dataset['shell'] = 'ready'
    loader.remove()
    failLoader(SIGN_IN)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(showFailure).not.toHaveBeenCalled()
  })

  describe('when the failure page cannot load', () => {
    it('says it in the loader, with the way forward focused', async () => {
      const { failLoader } = await loaderModule(false)
      const loader = loaderWithWords()
      failLoader(SIGN_IN)
      await vi.waitFor(() => {
        expect(loader.dataset['state']).toBe('error')
      })
      expect(part('detail').textContent).toBe('No matching state found in storage')
      expect(part('action').hidden).toBe(false)
      expect(part('action').textContent).toBe('Sign in again')
      expect(document.activeElement).toBe(part('action'))
    })

    it('says the action is under way once pressed, and runs it once', async () => {
      const { failLoader } = await loaderModule(false)
      const onAction = vi.fn()
      loaderWithWords()
      failLoader({ ...SIGN_IN, onAction })
      await vi.waitFor(() => {
        expect(part('action').hidden).toBe(false)
      })

      part('action').click()
      part('action').click()
      expect(onAction).toHaveBeenCalledOnce()
      expect(part('action').textContent).toBe('Redirecting…')
      expect(part('action').getAttribute('aria-busy')).toBe('true')
      expect(part('action').getAttribute('aria-disabled')).toBe('true')
      expect(document.activeElement).toBe(part('action'))
    })

    it('replaces what it says with a later failure, which can be acted on again', async () => {
      const { failLoader } = await loaderModule(false)
      const loader = loaderWithWords()
      failLoader(SIGN_IN)
      await vi.waitFor(() => {
        expect(loader.dataset['state']).toBe('error')
      })
      part('action').click()

      const onAction = vi.fn()
      failLoader({ ...UNREACHABLE, onAction })
      await vi.waitFor(() => {
        expect(part('status').textContent).toBe('The sign-in service is unreachable')
      })
      expect(part('detail').textContent).toBe('Failed to fetch')
      expect(part('action').textContent).toBe('Try again')
      expect(part('action').hasAttribute('aria-busy')).toBe(false)
      part('action').click()
      expect(onAction).toHaveBeenCalledOnce()
    })

    it('hides the action for a failure that has none', async () => {
      const { failLoader } = await loaderModule(false)
      loaderWithWords()
      failLoader(SIGN_IN)
      await vi.waitFor(() => {
        expect(part('action').hidden).toBe(false)
      })
      failLoader({ kind: 'configuration', title: 'Sign-in is not configured', detail: 'x' })
      await vi.waitFor(() => {
        expect(part('action').hidden).toBe(true)
      })
    })
  })
})
