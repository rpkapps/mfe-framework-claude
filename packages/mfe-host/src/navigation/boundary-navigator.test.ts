import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DiagnosticsHub,
  isMfeError,
  type BoundaryLocation,
  type Diagnostic,
  type NavigationBridge,
  type NavigationIntent,
  type Unsubscribe,
} from '@company/mfe-core'

import {
  BoundaryNavigator,
  createBrowserNavigationBridge,
  createNavigationIntent,
  parseBoundaryLocation,
  type NavigationBlocker,
} from './boundary-navigator.ts'

function recordingDiagnostics(): { readonly hub: DiagnosticsHub; readonly records: Diagnostic[] } {
  const records: Diagnostic[] = []
  const hub = new DiagnosticsHub()
  hub.add(diagnostic => records.push(diagnostic))
  return { hub, records }
}

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

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/**
 * A blocker that records into `order` whenever the host asks it anything, so
 * evaluation order can be asserted across nesting depths.
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
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
    const commit = vi.fn()

    const outcome = await navigator.requestNavigation(INTENT, commit)

    expect(outcome).toBe('proceeded')
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('commits exactly once when every blocker agrees, not once per blocker', async () => {
    const order: string[] = []
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
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
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
    navigator.registerBlocker('mount-middle', recordingBlocker('middle', 2, order))
    navigator.registerBlocker('mount-outer', recordingBlocker('outer', 1, order))
    navigator.registerBlocker('mount-inner', recordingBlocker('inner', 3, order))

    await navigator.requestNavigation(INTENT, vi.fn())

    expect(order).toEqual(['inner', 'middle', 'outer'])
  })

  it('stops at the first refusal and never asks the shallower mounts', async () => {
    const order: string[] = []
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
    navigator.registerBlocker('mount-outer', recordingBlocker('outer', 1, order))
    navigator.registerBlocker(
      'mount-inner',
      recordingBlocker('inner', 3, order, {
        decision: 'reset',
      }),
    )
    const commit = vi.fn()

    const outcome = await navigator.requestNavigation(INTENT, commit)

    // the current route and UI stay intact.
    expect(outcome).toBe('blocked')
    expect(order).toEqual(['inner'])
    expect(commit).not.toHaveBeenCalled()
  })

  it('never asks a mount that does not currently want to block', async () => {
    const order: string[] = []
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
    navigator.registerBlocker('mount-clean', recordingBlocker('clean', 3, order, { blocks: false }))
    navigator.registerBlocker('mount-dirty', recordingBlocker('dirty', 1, order))

    await navigator.requestNavigation(INTENT, vi.fn())

    expect(order).toEqual(['dirty'])
  })

  it('refuses a second request while a confirmation is still open', async () => {
    // the first navigation is waiting on the user.
    const order: string[] = []
    const answer = deferred<'proceed' | 'reset'>()
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
    navigator.registerBlocker(
      'mount-a',
      recordingBlocker('inner', 1, order, { confirmWith: () => answer.promise }),
    )
    const firstCommit = vi.fn()
    const secondCommit = vi.fn()
    const first = navigator.requestNavigation(INTENT, firstCommit)
    expect(navigator.isNegotiating).toBe(true)

    // a second intent arrives before the user answered.
    const secondOutcome = await navigator.requestNavigation(INTENT, secondCommit)

    // no competing dialog was opened.
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
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
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
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge(), diagnostics: hub })
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
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge(), diagnostics: hub })
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
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge(), diagnostics: hub })
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
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
    const unregister = navigator.registerBlocker('mount-a', recordingBlocker('a', 1, order))

    expect(navigator.blockerCount).toBe(1)
    unregister()

    expect(navigator.blockerCount).toBe(0)
    await expect(navigator.requestNavigation(INTENT, vi.fn())).resolves.toBe('proceeded')
  })

  it('removes a mount’s blocker as part of that mount’s disposal', async () => {
    const order: string[] = []
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
    navigator.registerBlocker('mount-a', recordingBlocker('a', 1, order, { decision: 'reset' }))

    navigator.removeMount('mount-a')

    await expect(navigator.requestNavigation(INTENT, vi.fn())).resolves.toBe('proceeded')
    expect(order).toEqual([])
  })

  it('replaces a blocker when the same mount registers again', async () => {
    const order: string[] = []
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
    navigator.registerBlocker('mount-a', recordingBlocker('first', 1, order))
    navigator.registerBlocker('mount-a', recordingBlocker('second', 1, order))

    await navigator.requestNavigation(INTENT, vi.fn())

    expect(navigator.blockerCount).toBe(1)
    expect(order).toEqual(['second'])
  })

  it('drops every blocker on forced cleanup, which cannot be vetoed', async () => {
    // forced cleanup follows session revocation or host disposal, and
    // is not a user navigation transaction.
    const order: string[] = []
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
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
    const navigator = new BoundaryNavigator({ bridge: createRecordingBridge() })
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

describe('bridge delegation', () => {
  it('forwards every navigation verb to the bridge it was given', () => {
    const bridge = createRecordingBridge()
    const navigator = new BoundaryNavigator({ bridge })

    navigator.push('/reports/42')
    navigator.replace('/reports/43')
    navigator.back()
    navigator.forward()
    navigator.reload()

    expect(bridge.push).toHaveBeenCalledWith('/reports/42')
    expect(bridge.replace).toHaveBeenCalledWith('/reports/43')
    expect(bridge.back).toHaveBeenCalledTimes(1)
    expect(bridge.forward).toHaveBeenCalledTimes(1)
    expect(bridge.reload).toHaveBeenCalledTimes(1)
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

describe('createBrowserNavigationBridge', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leaves the global History and event-listener methods untouched', () => {
    // capture the real functions before the bridge exists.
    const pushState = window.history.pushState
    const replaceState = window.history.replaceState
    const addEventListener = window.addEventListener
    const removeEventListener = window.removeEventListener

    // create the bridge and exercise every path that touches the globals.
    const bridge = createBrowserNavigationBridge()
    const unsubscribe = bridge.subscribe(() => undefined)
    bridge.push('/reports/42')
    bridge.replace('/reports/43')
    bridge.read()
    unsubscribe()

    // patching a global History method is precisely what this bridge
    // replaced, so each reference must still be the original function.
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
    // "/reports-archive" is a different App, not a route inside "/reports".
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
