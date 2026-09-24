// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { revealShell } from './loader.ts'

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
