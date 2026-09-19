/**
 * The boundary history, at the two points the rest of the framework leans on.
 *
 * Both were broken in ways nothing else could see. A history built without a
 * blocker store accepts every `useBlocker` registration and honours none of
 * them, and a bridge that drops the entry state leaves every navigation an App
 * makes with no position recorded — which is what tells a back from a forward,
 * and what a refused back navigation is rolled back by.
 */

import { BoundaryNavigator } from '@company/mfe-host'
import { createMemoryNavigationBridge } from '@company/mfe-host/testing'
import { describe, expect, it } from 'vitest'

import { createBoundaryHistory } from './boundary-history.ts'

/** What TanStack records on every entry, and the only field read back. */
function indexOf(state: unknown): unknown {
  return (state as Record<string, unknown> | undefined)?.['__TSR_index']
}

describe('blockers reach the history that was built by hand', () => {
  it('refuses a navigation while a blocker objects, and allows it once dropped', async () => {
    const bridge = createMemoryNavigationBridge(['/lab'])
    const boundary = createBoundaryHistory(bridge)

    const unblock = boundary.history.block({ blockerFn: () => true })
    boundary.history.push('/lab/storage')
    await Promise.resolve()

    expect(bridge.read().pathname).toBe('/lab')

    unblock()
    boundary.history.push('/lab/storage')
    await Promise.resolve()

    expect(bridge.read().pathname).toBe('/lab/storage')
  })

  it('hands the registered blockers back, so the host can ask them too', () => {
    const boundary = createBoundaryHistory(createMemoryNavigationBridge(['/lab']))
    expect(boundary.getBlockers()).toHaveLength(0)

    const first = { blockerFn: () => false }
    const second = { blockerFn: () => false, enableBeforeUnload: false }
    boundary.history.block(first)
    const dropSecond = boundary.history.block(second)

    // In registration order: the host asks them the same way the history does.
    expect(boundary.getBlockers()).toEqual([first, second])

    dropSecond()
    expect(boundary.getBlockers()).toEqual([first])
  })
})

describe('the entry state survives the trip through the bridge', () => {
  it('records a position on each entry a raw bridge is given', () => {
    const bridge = createMemoryNavigationBridge(['/lab'])
    const boundary = createBoundaryHistory(bridge)

    boundary.history.push('/lab/storage')

    expect(indexOf(bridge.readState?.())).toBe(1)
  })

  it('records one through a navigator, which is the bridge a real mount gets', () => {
    // `AppHost` builds every App's history over `runtime.navigator`, not over
    // the raw bridge. A navigator that dropped the state left both histories on
    // the page unable to classify a browser back.
    const bridge = createMemoryNavigationBridge(['/lab'])
    const navigator = new BoundaryNavigator({ bridge })
    const boundary = createBoundaryHistory(navigator)

    boundary.history.push('/lab/storage')

    expect(indexOf(navigator.readState())).toBe(1)
    expect(indexOf(bridge.readState?.())).toBe(1)
  })

  it('keeps the position when an entry is replaced rather than pushed', () => {
    const bridge = createMemoryNavigationBridge(['/lab'])
    const boundary = createBoundaryHistory(new BoundaryNavigator({ bridge }))

    boundary.history.push('/lab/storage')
    boundary.history.replace('/lab/storage?tab=session')

    expect(bridge.read().search).toBe('?tab=session')
    expect(indexOf(bridge.readState?.())).toBe(1)
  })
})

describe('listening to the bridge is owned by an effect, not by construction', () => {
  it('starts deaf, and hears the bridge only once attached', () => {
    const bridge = createMemoryNavigationBridge(['/lab', '/lab/storage'])
    const boundary = createBoundaryHistory(bridge)
    const heard: string[] = []
    boundary.history.subscribe(({ location }) => heard.push(location.pathname))

    // Building the history subscribes to nothing, so a memo React may
    // double-invoke and discard cannot leak a listener.
    bridge.back()
    expect(heard).toEqual([])

    const detach = boundary.attach()
    bridge.forward()
    expect(heard).toEqual(['/lab/storage'])

    detach()
    bridge.back()
    expect(heard).toEqual(['/lab/storage'])
  })

  it('hears it again after a detach and re-attach, which is what a remount is', () => {
    // React tears an effect down and sets it up again without re-running the
    // memo that built this. A subscription made at construction was removed by
    // that first cleanup and never re-made, and from then on the App's router
    // was never told the URL had moved.
    const bridge = createMemoryNavigationBridge(['/lab', '/lab/storage'])
    const boundary = createBoundaryHistory(bridge)
    const heard: string[] = []
    boundary.history.subscribe(({ location }) => heard.push(location.pathname))

    boundary.attach()()
    const detach = boundary.attach()

    bridge.back()
    expect(heard).toEqual(['/lab'])
    detach()
  })
})
