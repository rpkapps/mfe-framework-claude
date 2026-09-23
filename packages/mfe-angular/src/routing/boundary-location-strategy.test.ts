import { createMemoryNavigationBridge } from '@company/mfe-host/testing'
import { describe, expect, it, vi } from 'vitest'

import { BoundaryLocationStrategy } from './boundary-location-strategy.ts'

function strategyAt(entries: readonly string[], baseHref = '/reports') {
  const bridge = createMemoryNavigationBridge(entries)
  return { bridge, strategy: new BoundaryLocationStrategy(bridge, baseHref) }
}

describe('BoundaryLocationStrategy', () => {
  it('reads the full path from the bridge, as PathLocationStrategy reads the browser', () => {
    const { strategy } = strategyAt(['/reports/a?tab=2#top'])

    expect(strategy.path()).toBe('/reports/a?tab=2')
    expect(strategy.path(true)).toBe('/reports/a?tab=2#top')
    expect(strategy.getBaseHref()).toBe('/reports')
  })

  it('maps a route path under the base and back', () => {
    const { bridge, strategy } = strategyAt(['/reports'])

    strategy.pushState({ navigationId: 2 }, '', '/a', 'tab=2')

    expect(bridge.read()).toMatchObject({ pathname: '/reports/a', search: '?tab=2' })
    expect(strategy.getState()).toEqual({ navigationId: 2 })
    expect(strategy.prepareExternalUrl('/a')).toBe('/reports/a')
  })

  it('maps the App’s root to the boundary itself, without a trailing slash', () => {
    const { strategy } = strategyAt(['/reports'])

    expect(strategy.prepareExternalUrl('/')).toBe('/reports')
    expect(strategy.prepareExternalUrl('')).toBe('/reports')
    expect(strategy.prepareExternalUrl('/?tab=2')).toBe('/reports?tab=2')
  })

  it('joins onto a root boundary without doubling the slash', () => {
    const { strategy } = strategyAt(['/'], '/')

    expect(strategy.prepareExternalUrl('/')).toBe('/')
    expect(strategy.prepareExternalUrl('/a')).toBe('/a')
  })

  it('replaces the current entry rather than adding one', () => {
    const { bridge, strategy } = strategyAt(['/reports'])

    strategy.replaceState(null, '', '/b', '')

    expect(bridge.entries).toEqual(['/reports/b'])
  })

  it('reports a navigation it did not make, once, and only while the page is still the App’s', async () => {
    const { bridge, strategy } = strategyAt(['/reports/a', '/elsewhere', '/reports/b'])
    const listener = vi.fn()
    strategy.onPopState(listener)

    bridge.back()
    bridge.reload()
    bridge.back()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ type: 'popstate', state: { __TSR_index: 0 } })
    expect(bridge.read().pathname).toBe('/reports/a')
    await Promise.resolve()
  })

  it('steps through the bridge’s history, a whole delta at a time when it can', () => {
    const { bridge, strategy } = strategyAt(['/reports/a', '/reports/b', '/reports/c'])

    strategy.historyGo(-2)
    expect(bridge.read().pathname).toBe('/reports/a')
    strategy.forward()
    expect(bridge.read().pathname).toBe('/reports/b')
    strategy.back()
    expect(bridge.read().pathname).toBe('/reports/a')
  })

  it('stops listening once disposed', () => {
    const { bridge, strategy } = strategyAt(['/reports/a', '/reports/b'])
    const listener = vi.fn()
    strategy.onPopState(listener)

    strategy.dispose()
    bridge.back()

    expect(listener).not.toHaveBeenCalled()
  })
})
