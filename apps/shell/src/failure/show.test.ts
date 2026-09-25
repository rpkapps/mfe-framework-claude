// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Failure } from './failure-page.tsx'
import type * as Show from './show.tsx'

const SIGN_IN: Failure = {
  kind: 'sign-in',
  title: 'We could not sign you in',
  detail: 'No matching state found in storage',
  actionLabel: 'Sign in again',
  pendingLabel: 'Redirecting…',
  onAction: () => undefined,
}

const UNREACHABLE: Failure = {
  kind: 'unreachable',
  title: 'The sign-in service is unreachable',
  detail: 'Failed to fetch',
  actionLabel: 'Try again',
  onAction: () => undefined,
}

async function showFailureModule(): Promise<typeof Show> {
  vi.resetModules()
  return await import('./show.tsx')
}

function action(): HTMLButtonElement {
  return document.querySelector('[data-failure-action]') as HTMLButtonElement
}

function title(): HTMLElement {
  return document.querySelector('[data-failure-title]') as HTMLElement
}

describe('showFailure', () => {
  beforeEach(() => {
    // Reduced motion, so the loader is removed at once rather than after its fade.
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    document.body.innerHTML = '<div id="shell-loader" data-state="failing"></div>'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fades the page in over the loader and focuses the way forward', async () => {
    const { showFailure } = await showFailureModule()
    showFailure(SIGN_IN)

    await vi.waitFor(() => {
      expect(document.getElementById('shell-failure')?.dataset['shown']).toBe('')
    })
    expect(document.getElementById('shell-loader')).toBeNull()
    expect(title().textContent).toBe('We could not sign you in')
    expect(document.activeElement).toBe(action())
  })

  it('says the action is under way once pressed, and runs it once', async () => {
    const { showFailure } = await showFailureModule()
    const onAction = vi.fn()
    showFailure({ ...SIGN_IN, onAction })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(action())
    })

    action().click()
    action().click()
    await vi.waitFor(() => {
      expect(action().getAttribute('aria-busy')).toBe('true')
    })
    expect(action().getAttribute('aria-disabled')).toBe('true')
    expect(action().textContent).toContain('Redirecting…')
    expect(onAction).toHaveBeenCalledOnce()
    // Still focused, so a screen reader that pressed it hears where the page is going.
    expect(document.activeElement).toBe(action())
  })

  it('shows a later failure in place of the first, with its news focused', async () => {
    const { showFailure } = await showFailureModule()
    showFailure(SIGN_IN)
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(action())
    })
    action().click()

    const onAction = vi.fn()
    showFailure({ ...UNREACHABLE, onAction })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(title())
    })
    expect(document.querySelectorAll('#shell-failure')).toHaveLength(1)
    expect(title().textContent).toBe('The sign-in service is unreachable')
    expect(document.querySelector('[data-failure]')?.getAttribute('data-failure')).toBe(
      'unreachable',
    )
    // A fresh action, which can be pressed again.
    expect(action().hasAttribute('aria-busy')).toBe(false)
    action().click()
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('copies the reason, and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { showFailure } = await showFailureModule()
    showFailure(SIGN_IN)
    const copy = await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('[aria-label="Copy reason"]')
      expect(button).not.toBeNull()
      return button as HTMLButtonElement
    })

    copy.click()
    expect(writeText).toHaveBeenCalledWith('No matching state found in storage')
    await vi.waitFor(() => {
      expect(copy.getAttribute('aria-label')).toBe('Copied')
    })
  })
})
