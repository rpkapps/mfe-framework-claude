import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isMfeError,
  type BoundaryLocation,
  type NavigationBridge,
  type NavigationIntent,
  type Unsubscribe,
} from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'
import {
  BoundaryNavigator,
  boundaryDefinitionId,
  createBrowserNavigationBridge,
  createNavigationIntent,
  parseBoundaryLocation,
  type NavigationBlocker,
} from './boundary-navigator.ts'
import { deferred, recordingDiagnostics } from '../__tests__/harness.ts'
import { createMemoryNavigationBridge } from '../testing/memory-navigation-bridge.ts'

const INTENT: NavigationIntent = {
  from: { pathname: '/reports/42/edit', search: '', hash: '' },
  to: { pathname: '/billing', search: '', hash: '' },
  leavesBoundary: true,
}

function createRecordingBridge(): NavigationBridge & {
  readonly listeners: ((location: BoundaryLocation) => void)[]
} {
  const listeners: ((location: BoundaryLocation) => void)[] = []
  return {
    listeners,
    read: vi.fn((): BoundaryLocation => ({ pathname: '/reports', search: '', hash: '' })),
    readState: vi.fn((): unknown => ({ __TSR_index: 7 })),
    subscribe: vi.fn((listener: (location: BoundaryLocation) => void): Unsubscribe => {
      listeners.push(listener)
      return () => {
        listeners.splice(listeners.indexOf(listener), 1)
      }
    }),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
  }
}

/** One navigator over a fresh recording bridge, which is what most cases need. */
function createNavigator(diagnostics?: DiagnosticsHub): BoundaryNavigator {
  return new BoundaryNavigator({
    bridge: createRecordingBridge(),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  })
}

/**
 * A blocker that records into `order` whenever the host asks it anything, so evaluation
 * order can be asserted across nesting depths.
 */
function recordingBlocker(
  name: string,
  depth: number,
  order: string[],
  options: {
    readonly blocks?: boolean
    readonly decision?: 'proceed' | 'reset'
    readonly confirmWith?: () => Promise<'proceed' | 'reset'>
  } = {},
): NavigationBlocker {
  return {
    depth,
    shouldBlock: () => options.blocks ?? true,
    confirm: () => {
      order.push(name)
      if (options.confirmWith) return options.confirmWith()
      return Promise.resolve(options.decision ?? 'proceed')
    },
  }
}

describe('requestNavigation', () => {
  it('commits exactly once when no mount wants to block', async () => {
    const navigator = createNavigator()
    const commit = vi.fn()

    const outcome = await navigator.requestNavigation(INTENT, commit)

    expect(outcome).toBe('proceeded')
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('commits exactly once when every blocker agrees, not once per blocker', async () => {
    const order: string[] = []
    const navigator = createNavigator()
    navigator.registerBlocker('mount-a', recordingBlocker('outer', 1, order))
    navigator.registerBlocker('mount-b', recordingBlocker('middle', 2, order))
    navigator.registerBlocker('mount-c', recordingBlocker('inner', 3, order))
    const commit = vi.fn()

    const outcome = await navigator.requestNavigation(INTENT, commit)

    expect(outcome).toBe('proceeded')
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('asks the innermost mount first and works outwards', async () => {
    // registration order deliberately does not match nesting depth.
    const order: string[] = []
    const navigator = createNavigator()
    navigator.registerBlocker('mount-middle', recordingBlocker('middle', 2, order))
    navigator.registerBlocker('mount-outer', recordingBlocker('outer', 1, order))
    navigator.registerBlocker('mount-inner', recordingBlocker('inner', 3, order))

    await navigator.requestNavigation(INTENT, vi.fn())

    expect(order).toEqual(['inner', 'middle', 'outer'])
  })

  it('stops at the first refusal and never asks the shallower mounts', async () => {
    const order: string[] = []
    const navigator = createNavigator()
    navigator.registerBlocker('mount-outer', recordingBlocker('outer', 1, order))
    navigator.registerBlocker(
      'mount-inner',
      recordingBlocker('inner', 3, order, {
        decision: 'reset',
      }),
    )
    const commit = vi.fn()

    const outcome = await navigator.requestNavigation(INTENT, commit)

    expect(outcome).toBe('blocked')
    expect(order).toEqual(['inner'])
    expect(commit).not.toHaveBeenCalled()
  })

  it('never asks a mount that does not currently want to block', async () => {
    const order: string[] = []
    const navigator = createNavigator()
    navigator.registerBlocker('mount-clean', recordingBlocker('clean', 3, order, { blocks: false }))
    navigator.registerBlocker('mount-dirty', recordingBlocker('dirty', 1, order))

    await navigator.requestNavigation(INTENT, vi.fn())

    expect(order).toEqual(['dirty'])
  })

  it('refuses a second request while a confirmation is still open', async () => {
    const order: string[] = []
    const answer = deferred<'proceed' | 'reset'>()
    const navigator = createNavigator()
    navigator.registerBlocker(
      'mount-a',
      recordingBlocker('inner', 1, order, { confirmWith: () => answer.promise }),
    )
    const firstCommit = vi.fn()
    const secondCommit = vi.fn()
    const first = navigator.requestNavigation(INTENT, firstCommit)
    expect(navigator.isNegotiating).toBe(true)

    const secondOutcome = await navigator.requestNavigation(INTENT, secondCommit)

    expect(secondOutcome).toBe('blocked')
    expect(secondCommit).not.toHaveBeenCalled()
    expect(order).toEqual(['inner'])

    answer.resolve('proceed')
    await expect(first).resolves.toBe('proceeded')
    expect(firstCommit).toHaveBeenCalledTimes(1)
    expect(navigator.isNegotiating).toBe(false)
  })

  it('accepts a new request once the previous negotiation finished', async () => {
    const order: string[] = []
    const navigator = createNavigator()
    navigator.registerBlocker('mount-a', recordingBlocker('inner', 1, order, { decision: 'reset' }))

    await navigator.requestNavigation(INTENT, vi.fn())
    expect(navigator.isNegotiating).toBe(false)

    const second = await navigator.requestNavigation(INTENT, vi.fn())

    expect(second).toBe('blocked')
    expect(order).toEqual(['inner', 'inner'])
  })
})

describe('misbehaving blockers', () => {
  it('treats a blocker whose check throws as non-blocking and diagnoses it', async () => {
    const { hub, records } = recordingDiagnostics()
    const navigator = createNavigator(hub)
    const confirm = vi.fn(async () => 'reset' as const)
    navigator.registerBlocker('mount-a', {
      depth: 1,
      shouldBlock: () => {
        throw new Error('read of undefined form state')
      },
      confirm,
    })
    const commit = vi.fn()

    const outcome = await navigator.requestNavigation(INTENT, commit)

    expect(outcome).toBe('proceeded')
    expect(commit).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
    expect(records).toHaveLength(1)
    expect(records[0]?.error.code).toBe('app/invalid-router')
    expect(records[0]?.error.message).toContain('synchronous read')
  })

  it('cancels the navigation when a confirmation rejects, rather than discarding work', async () => {
    const { hub, records } = recordingDiagnostics()
    const navigator = createNavigator(hub)
    navigator.registerBlocker('mount-a', {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => Promise.reject(new Error('dialog failed to render')),
    })
    const commit = vi.fn()

    const outcome = await navigator.requestNavigation(INTENT, commit)

    expect(outcome).toBe('blocked')
    expect(commit).not.toHaveBeenCalled()
    expect(records).toHaveLength(1)
    expect(records[0]?.error.message).toContain('cancelled to avoid discarding unsaved work')
    expect(navigator.isNegotiating).toBe(false)
  })

  it('keeps asking the remaining mounts when one blocker opts out by throwing', async () => {
    const { hub } = recordingDiagnostics()
    const order: string[] = []
    const navigator = createNavigator(hub)
    navigator.registerBlocker('mount-broken', {
      depth: 3,
      shouldBlock: () => {
        throw new Error('broken')
      },
      confirm: () => Promise.resolve('proceed'),
    })
    navigator.registerBlocker('mount-ok', recordingBlocker('ok', 1, order))

    const outcome = await navigator.requestNavigation(INTENT, vi.fn())

    expect(outcome).toBe('proceeded')
    expect(order).toEqual(['ok'])
  })
})

describe('blocker registration', () => {
  it('removes a blocker through its unsubscribe', async () => {
    const order: string[] = []
    const navigator = createNavigator()
    const unregister = navigator.registerBlocker('mount-a', recordingBlocker('a', 1, order))

    expect(navigator.blockerCount).toBe(1)
    unregister()

    expect(navigator.blockerCount).toBe(0)
    await expect(navigator.requestNavigation(INTENT, vi.fn())).resolves.toBe('proceeded')
  })

  it('removes a mount’s blocker as part of that mount’s disposal', async () => {
    const order: string[] = []
    const navigator = createNavigator()
    navigator.registerBlocker('mount-a', recordingBlocker('a', 1, order, { decision: 'reset' }))

    navigator.removeMount('mount-a')

    await expect(navigator.requestNavigation(INTENT, vi.fn())).resolves.toBe('proceeded')
    expect(order).toEqual([])
  })

  it('keeps every blocker one mount registers, and asks them all', async () => {
    const order: string[] = []
    const navigator = createNavigator()
    navigator.registerBlocker('mount-a', recordingBlocker('first', 1, order))
    navigator.registerBlocker('mount-a', recordingBlocker('second', 1, order))

    await navigator.requestNavigation(INTENT, vi.fn())

    expect(navigator.blockerCount).toBe(2)
    expect(order).toEqual(['first', 'second'])
  })

  it('removes every blocker a mount registered when that mount is disposed', async () => {
    const order: string[] = []
    const navigator = createNavigator()
    navigator.registerBlocker('mount-a', recordingBlocker('first', 1, order))
    navigator.registerBlocker('mount-a', recordingBlocker('second', 1, order))
    navigator.registerBlocker('mount-b', recordingBlocker('other', 1, order))

    navigator.removeMount('mount-a')

    await navigator.requestNavigation(INTENT, vi.fn())

    expect(navigator.blockerCount).toBe(1)
    expect(order).toEqual(['other'])
  })

  it('drops every blocker on forced cleanup, which cannot be vetoed', async () => {
    const order: string[] = []
    const navigator = createNavigator()
    navigator.registerBlocker('mount-a', recordingBlocker('a', 1, order, { decision: 'reset' }))
    navigator.registerBlocker('mount-b', recordingBlocker('b', 2, order, { decision: 'reset' }))
    const commit = vi.fn()

    navigator.clearBlockers()
    const outcome = await navigator.requestNavigation(INTENT, commit)

    expect(navigator.blockerCount).toBe(0)
    expect(outcome).toBe('proceeded')
    expect(commit).toHaveBeenCalledTimes(1)
    expect(order).toEqual([])
  })

  it('releases a stuck negotiation on forced cleanup', async () => {
    const order: string[] = []
    const answer = deferred<'proceed' | 'reset'>()
    const navigator = createNavigator()
    navigator.registerBlocker(
      'mount-a',
      recordingBlocker('a', 1, order, { confirmWith: () => answer.promise }),
    )
    void navigator.requestNavigation(INTENT, vi.fn())
    expect(navigator.isNegotiating).toBe(true)

    navigator.clearBlockers()

    expect(navigator.isNegotiating).toBe(false)
    await expect(navigator.requestNavigation(INTENT, vi.fn())).resolves.toBe('proceeded')
    answer.resolve('proceed')
  })
})

describe('the browser unload prompt', () => {
  it('is not offered when nothing is registered', () => {
    expect(createNavigator().wantsUnloadPrompt()).toBe(false)
  })

  it('is offered by a blocker that has not said otherwise', () => {
    const navigator = createNavigator()
    navigator.registerBlocker('mount-a', recordingBlocker('a', 1, []))

    expect(navigator.wantsUnloadPrompt()).toBe(true)
  })

  it('is refused only when every blocker refuses it', () => {
    const navigator = createNavigator()
    const quiet = { ...recordingBlocker('quiet', 1, []), shouldBlockUnload: () => false }
    const loud = { ...recordingBlocker('loud', 1, []), shouldBlockUnload: () => true }

    const drop = navigator.registerBlocker('mount-a', quiet)
    expect(navigator.wantsUnloadPrompt()).toBe(false)

    navigator.registerBlocker('mount-b', loud)
    expect(navigator.wantsUnloadPrompt()).toBe(true)

    drop()
    expect(navigator.wantsUnloadPrompt()).toBe(true)
  })

  it('offers the prompt when the question throws, rather than losing work quietly', () => {
    const { hub, records } = recordingDiagnostics()
    const navigator = createNavigator(hub)
    navigator.registerBlocker('mount-a', {
      ...recordingBlocker('broken', 1, []),
      shouldBlockUnload: () => {
        throw new Error('broken')
      },
    })

    expect(navigator.wantsUnloadPrompt()).toBe(true)
    expect(records).toHaveLength(1)
    expect(records[0]?.error.message).toContain('losing it silently discards work')
  })
})

describe('bridge delegation', () => {
  it('forwards every navigation verb to the bridge it was given', () => {
    const bridge = createRecordingBridge()
    const navigator = new BoundaryNavigator({ bridge })

    navigator.push('/reports/42')
    navigator.replace('/reports/43')
    navigator.back()
    navigator.forward()
    navigator.reload()

    expect(bridge.push).toHaveBeenCalledWith('/reports/42', undefined)
    expect(bridge.replace).toHaveBeenCalledWith('/reports/43', undefined)
    expect(bridge.back).toHaveBeenCalledTimes(1)
    expect(bridge.forward).toHaveBeenCalledTimes(1)
    expect(bridge.reload).toHaveBeenCalledTimes(1)
  })

  it('carries the entry state through, because a mount’s history lives in it', () => {
    const bridge = createRecordingBridge()
    const navigator = new BoundaryNavigator({ bridge })

    navigator.push('/reports/42', { __TSR_index: 3 })
    navigator.replace('/reports/43', { __TSR_index: 3 })

    expect(bridge.push).toHaveBeenCalledWith('/reports/42', { __TSR_index: 3 })
    expect(bridge.replace).toHaveBeenCalledWith('/reports/43', { __TSR_index: 3 })
    expect(navigator.readState()).toEqual({ __TSR_index: 7 })
  })

  it('traverses through the bridge, and single-steps when it cannot', () => {
    const withGo = { ...createRecordingBridge(), go: vi.fn() }
    new BoundaryNavigator({ bridge: withGo }).go(-2)
    expect(withGo.go).toHaveBeenCalledWith(-2)

    const withoutGo = createRecordingBridge()
    const navigator = new BoundaryNavigator({ bridge: withoutGo })
    navigator.go(-2)
    navigator.go(1)
    navigator.go(0)
    expect(withoutGo.back).toHaveBeenCalledTimes(1)
    expect(withoutGo.forward).toHaveBeenCalledTimes(1)
  })

  it('holds an external navigation while one is being negotiated, and releases it', async () => {
    const bridge = createRecordingBridge()
    const navigator = new BoundaryNavigator({ bridge })
    const answer = deferred<'proceed' | 'reset'>()
    navigator.registerBlocker('mount-a', {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => answer.promise,
    })

    const heard: BoundaryLocation[] = []
    navigator.subscribe(location => heard.push(location))

    const negotiation = navigator.requestNavigation(INTENT, vi.fn())
    bridge.listeners[0]?.({ pathname: '/billing', search: '', hash: '' })
    await Promise.resolve()
    await Promise.resolve()

    expect(heard).toEqual([])

    answer.resolve('proceed')
    await negotiation

    expect(heard).toEqual([{ pathname: '/reports', search: '', hash: '' }])
  })

  it('discards one the negotiation refused, because the host restores the URL', async () => {
    const bridge = createRecordingBridge()
    const navigator = new BoundaryNavigator({ bridge })
    const answer = deferred<'proceed' | 'reset'>()
    navigator.registerBlocker('mount-a', {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => answer.promise,
    })

    const heard: BoundaryLocation[] = []
    navigator.subscribe(location => heard.push(location))

    const negotiation = navigator.requestNavigation(INTENT, vi.fn())
    bridge.listeners[0]?.({ pathname: '/billing', search: '', hash: '' })
    await Promise.resolve()

    answer.resolve('reset')
    expect(await negotiation).toBe('blocked')
    await Promise.resolve()

    expect(heard).toEqual([])

    bridge.listeners[0]?.({ pathname: '/reports', search: '', hash: '' })
    await Promise.resolve()
    expect(heard).toHaveLength(1)
  })

  it('releases a held navigation on forced cleanup, rather than going deaf', async () => {
    const bridge = createRecordingBridge()
    const navigator = new BoundaryNavigator({ bridge })
    navigator.registerBlocker('mount-a', {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => new Promise(() => undefined),
    })

    const heard: BoundaryLocation[] = []
    navigator.subscribe(location => heard.push(location))

    void navigator.requestNavigation(INTENT, vi.fn())
    bridge.listeners[0]?.({ pathname: '/billing', search: '', hash: '' })
    await Promise.resolve()
    expect(heard).toEqual([])

    navigator.clearBlockers()
    expect(heard).toHaveLength(1)
  })

  it('stops holding anything for a listener that unsubscribed', async () => {
    const bridge = createRecordingBridge()
    const navigator = new BoundaryNavigator({ bridge })
    const answer = deferred<'proceed' | 'reset'>()
    navigator.registerBlocker('mount-a', {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => answer.promise,
    })

    const heard: BoundaryLocation[] = []
    const unsubscribe = navigator.subscribe(location => heard.push(location))

    const negotiation = navigator.requestNavigation(INTENT, vi.fn())
    bridge.listeners[0]?.({ pathname: '/billing', search: '', hash: '' })
    await Promise.resolve()
    unsubscribe()

    answer.resolve('proceed')
    await negotiation

    expect(heard).toEqual([])
  })

  it('reads and subscribes through the bridge', () => {
    const bridge = createRecordingBridge()
    const navigator = new BoundaryNavigator({ bridge })
    const listener = vi.fn()

    expect(navigator.read()).toEqual({ pathname: '/reports', search: '', hash: '' })
    const unsubscribe = navigator.subscribe(listener)
    expect(bridge.listeners).toHaveLength(1)

    unsubscribe()
    expect(bridge.listeners).toHaveLength(0)
  })
})

/** A host's own router moves the page without the bridge hearing it; `announce` tells mounts. */
describe('announce', () => {
  const at = (pathname: string): BoundaryLocation => ({ pathname, search: '', hash: '' })

  function announcing(initial = '/reports') {
    const bridge = createMemoryNavigationBridge([initial])
    const navigator = new BoundaryNavigator({ bridge })
    const heard: string[] = []
    const unsubscribe = navigator.subscribe(location => heard.push(location.pathname))
    return { bridge, navigator, heard, unsubscribe }
  }

  it('tells every subscriber where a navigation the host made itself took the page', () => {
    const { bridge, navigator, heard } = announcing()
    const second: BoundaryLocation[] = []
    navigator.subscribe(location => second.push(location))

    bridge.push('/reports/42')
    navigator.announce()

    expect(heard).toEqual(['/reports/42'])
    expect(second).toEqual([at('/reports/42')])
  })

  it('emits nothing when the page is where subscribers were last told it is', () => {
    const { bridge, navigator, heard } = announcing()

    navigator.announce()
    bridge.push('/reports/42')
    navigator.announce()
    navigator.announce()

    expect(heard).toEqual(['/reports/42'])
  })

  it('repeats nothing the bridge already delivered', async () => {
    const { bridge, navigator, heard } = announcing()
    bridge.push('/reports/42')
    bridge.back()
    await Promise.resolve()
    expect(heard).toEqual(['/reports'])

    navigator.announce()

    expect(heard).toEqual(['/reports'])
  })

  it('treats a push through the navigator as known, and still announces a return from it', () => {
    const { bridge, navigator, heard } = announcing()

    // A mounted App navigates inside its boundary; it already knows where it went.
    navigator.push('/reports/42')
    navigator.announce()
    expect(heard).toEqual([])

    // The host then takes the page back to where the App started.
    bridge.push('/reports')
    navigator.announce()

    expect(heard).toEqual(['/reports'])
  })

  it('holds an announcement while a navigation is negotiated, and releases it if it proceeds', async () => {
    const { bridge, navigator, heard } = announcing()
    const answer = deferred<'proceed' | 'reset'>()
    navigator.registerBlocker('mount-a', {
      depth: 1,
      shouldBlock: () => true,
      confirm: () => answer.promise,
    })

    const negotiation = navigator.requestNavigation(INTENT, vi.fn())
    bridge.push('/billing')
    navigator.announce()
    expect(heard).toEqual([])

    answer.resolve('proceed')
    await negotiation

    expect(heard).toEqual(['/billing'])
  })

  it('announces nothing to a listener that unsubscribed', () => {
    const { bridge, navigator, heard, unsubscribe } = announcing()

    unsubscribe()
    bridge.push('/reports/42')
    navigator.announce()

    expect(heard).toEqual([])
  })
})

describe('createBrowserNavigationBridge', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leaves the global History and event-listener methods untouched', () => {
    const pushState = window.history.pushState
    const replaceState = window.history.replaceState
    const addEventListener = window.addEventListener
    const removeEventListener = window.removeEventListener

    const bridge = createBrowserNavigationBridge()
    const unsubscribe = bridge.subscribe(() => undefined)
    bridge.push('/reports/42')
    bridge.replace('/reports/43')
    bridge.read()
    unsubscribe()

    expect(window.history.pushState).toBe(pushState)
    expect(window.history.replaceState).toBe(replaceState)
    expect(window.addEventListener).toBe(addEventListener)
    expect(window.removeEventListener).toBe(removeEventListener)
  })

  it('reads the current location', () => {
    window.history.replaceState(null, '', '/reports/42?tab=summary#totals')
    const bridge = createBrowserNavigationBridge()

    expect(bridge.read()).toEqual({
      pathname: '/reports/42',
      search: '?tab=summary',
      hash: '#totals',
    })
  })

  it('pushes through to the real history, adding an entry', () => {
    const bridge = createBrowserNavigationBridge()
    const before = window.history.length

    bridge.push('/reports/42')

    expect(window.location.pathname).toBe('/reports/42')
    expect(window.history.length).toBe(before + 1)
  })

  it('replaces through to the real history without adding an entry', () => {
    const bridge = createBrowserNavigationBridge()
    const before = window.history.length

    bridge.replace('/reports/43')

    expect(window.location.pathname).toBe('/reports/43')
    expect(window.history.length).toBe(before)
  })

  it('adds a popstate listener on subscribe and removes it on unsubscribe', () => {
    const bridge = createBrowserNavigationBridge()
    const listener = vi.fn()
    const unsubscribe = bridge.subscribe(listener)

    window.history.replaceState(null, '', '/reports/42')
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ pathname: '/reports/42', search: '', hash: '' })

    unsubscribe()
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not emit synthetic popstate events of its own', () => {
    const bridge = createBrowserNavigationBridge()
    const listener = vi.fn()
    bridge.subscribe(listener)

    bridge.push('/reports/42')
    bridge.replace('/reports/43')

    expect(listener).not.toHaveBeenCalled()
  })

  it('delegates back and forward to the window it was given', () => {
    const back = vi.fn()
    const forward = vi.fn()
    const target = {
      location: window.location,
      history: { back, forward, pushState: vi.fn(), replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window

    const bridge = createBrowserNavigationBridge(target)
    bridge.back()
    bridge.forward()

    expect(back).toHaveBeenCalledTimes(1)
    expect(forward).toHaveBeenCalledTimes(1)
  })
})

describe('createNavigationIntent', () => {
  const from: BoundaryLocation = { pathname: '/reports', search: '', hash: '' }

  function to(pathname: string): BoundaryLocation {
    return { pathname, search: '', hash: '' }
  }

  it('stays inside the boundary for a descendant path', () => {
    expect(createNavigationIntent(from, to('/reports/42'), '/reports').leavesBoundary).toBe(false)
  })

  it('stays inside the boundary for the boundary path itself', () => {
    expect(createNavigationIntent(from, to('/reports'), '/reports').leavesBoundary).toBe(false)
  })

  it('leaves the boundary for a sibling path that merely shares the prefix', () => {
    expect(createNavigationIntent(from, to('/reports-archive'), '/reports').leavesBoundary).toBe(
      true,
    )
  })

  it('leaves the boundary for an unrelated path', () => {
    expect(createNavigationIntent(from, to('/billing'), '/reports').leavesBoundary).toBe(true)
  })

  it('treats an empty base path as containing everything', () => {
    expect(createNavigationIntent(from, to('/anything/at/all'), '').leavesBoundary).toBe(false)
  })

  it('ignores a trailing slash on the base path', () => {
    expect(createNavigationIntent(from, to('/reports'), '/reports/').leavesBoundary).toBe(false)
    expect(createNavigationIntent(from, to('/reports/42'), '/reports/').leavesBoundary).toBe(false)
    expect(createNavigationIntent(from, to('/reports-archive'), '/reports/').leavesBoundary).toBe(
      true,
    )
  })

  it('carries the from and to locations through unchanged', () => {
    const target = to('/reports/42')

    const intent = createNavigationIntent(from, target, '/reports')

    expect(intent.from).toBe(from)
    expect(intent.to).toBe(target)
  })
})

describe('parseBoundaryLocation', () => {
  it('parses a path with a query string and a hash', () => {
    expect(parseBoundaryLocation('/reports/42?tab=summary#totals')).toEqual({
      pathname: '/reports/42',
      search: '?tab=summary',
      hash: '#totals',
    })
  })

  it('parses a bare path with no query or hash', () => {
    expect(parseBoundaryLocation('/reports')).toEqual({
      pathname: '/reports',
      search: '',
      hash: '',
    })
  })

  it('parses an absolute URL, keeping only the boundary-relevant parts', () => {
    expect(parseBoundaryLocation('https://app.example.test/reports/42?tab=a#b')).toEqual({
      pathname: '/reports/42',
      search: '?tab=a',
      hash: '#b',
    })
  })

  it('resolves a relative path against the supplied base', () => {
    expect(parseBoundaryLocation('42', 'https://app.example.test/reports/')).toEqual({
      pathname: '/reports/42',
      search: '',
      hash: '',
    })
  })

  it.each([
    ['an empty authority', 'http://'],
    ['a malformed host', 'https://[not-a-host'],
  ])('throws a structured invalid base path error for %s', (_label, garbage) => {
    try {
      parseBoundaryLocation(garbage)
      expect.unreachable('parsing should have thrown')
    } catch (error) {
      expect(isMfeError(error)).toBe(true)
      if (!isMfeError(error)) return
      expect(error.code).toBe('app/invalid-base-path')
      expect(error.id).toBe('navigation')
      expect(error.message).toContain('a path or absolute URL')
      expect(error.message).toContain('"/reports/42"')
      expect(error.cause).toBeInstanceOf(Error)
    }
  })
})

describe('boundaryDefinitionId', () => {
  it.each([
    ['the host’s own page', '/', undefined],
    ['an empty path', '', undefined],
    ['an App at its root', '/operations', 'operations'],
    ['a route inside an App', '/operations/wells/reduced-dls', 'operations'],
    ['a trailing slash', '/operations/', 'operations'],
    ['a query and a hash', '/operations?tab=a#b', 'operations'],
    ['an absolute URL', 'https://app.example.test/operations/wells', 'operations'],
  ])('reads %s as %s', (_label, path, expected) => {
    expect(boundaryDefinitionId(path)).toBe(expected)
  })

  it('names a segment the registry has never heard of', () => {
    expect(boundaryDefinitionId('/not-registered/anything')).toBe('not-registered')
  })

  it('agrees with the base path an intent is built against', () => {
    const path = '/reports/42'
    const basePath = `/${boundaryDefinitionId(path) ?? ''}`

    expect(
      createNavigationIntent(
        parseBoundaryLocation(path),
        parseBoundaryLocation('/reports/7'),
        basePath,
      ).leavesBoundary,
    ).toBe(false)
  })
})
