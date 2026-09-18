import { describe, expect, it, vi } from 'vitest'

import type { ShellState, ShellUser } from '@company/mfe-core'

import {
  requiresSessionRetirement,
  SHELL_STATE_FIELDS,
  ShellStateStore,
  type ShellStateChange,
} from './shell-state-store.ts'

const ADA: ShellUser = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  accountId: 'account-1',
  tenantId: 'tenant-1',
}

function initialState(overrides: Partial<ShellState> = {}): ShellState {
  return {
    user: ADA,
    groups: ['analysts', 'viewers'],
    theme: 'light',
    ...overrides,
  }
}

/** Subscribes a counting listener to every field so call counts are comparable. */
function watchAllFields(store: ShellStateStore): Record<string, ReturnType<typeof vi.fn>> {
  const listeners: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const field of SHELL_STATE_FIELDS) {
    const listener = vi.fn()
    listeners[field] = listener
    store.subscribeToField(field, listener)
  }
  return listeners
}

function listenerFor(
  listeners: Record<string, ReturnType<typeof vi.fn>>,
  field: string,
): ReturnType<typeof vi.fn> {
  const listener = listeners[field]
  if (!listener) throw new Error(`no listener registered for "${field}"`)
  return listener
}

describe('per-field subscriptions', () => {
  it('notifies only the theme subscriber when only the theme changed', () => {
    const store = new ShellStateStore(initialState())
    const listeners = watchAllFields(store)

    store.apply({ theme: 'dark' })

    // a consumer that reads only the user or the groups must not
    // re-render because the shell changed its theme.
    expect(listenerFor(listeners, 'theme')).toHaveBeenCalledTimes(1)
    expect(listenerFor(listeners, 'user')).toHaveBeenCalledTimes(0)
    expect(listenerFor(listeners, 'groups')).toHaveBeenCalledTimes(0)
  })

  it('notifies only the user subscriber when only the user changed', () => {
    const store = new ShellStateStore(initialState())
    const listeners = watchAllFields(store)

    store.apply({ user: { ...ADA, id: 'user-2', name: 'Grace Hopper' } })

    expect(listenerFor(listeners, 'user')).toHaveBeenCalledTimes(1)
    expect(listenerFor(listeners, 'theme')).toHaveBeenCalledTimes(0)
    expect(listenerFor(listeners, 'groups')).toHaveBeenCalledTimes(0)
  })

  it('notifies only the groups subscriber when only the groups changed', () => {
    const store = new ShellStateStore(initialState())
    const listeners = watchAllFields(store)

    store.apply({ groups: ['analysts', 'viewers', 'admins'] })

    expect(listenerFor(listeners, 'groups')).toHaveBeenCalledTimes(1)
    expect(listenerFor(listeners, 'user')).toHaveBeenCalledTimes(0)
    expect(listenerFor(listeners, 'theme')).toHaveBeenCalledTimes(0)
  })

  it('stops notifying a field listener once it unsubscribes', () => {
    const store = new ShellStateStore(initialState())
    const listener = vi.fn()
    const unsubscribe = store.subscribeToField('theme', listener)

    store.apply({ theme: 'dark' })
    unsubscribe()
    store.apply({ theme: 'light' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.fieldListenerCount('theme')).toBe(0)
  })

  it('exposes a stable subscribe reference so React need not resubscribe', () => {
    const store = new ShellStateStore(initialState())
    expect(store.subscribeToField).toBe(store.subscribeToField)
    expect(store.getSnapshot).toBe(store.getSnapshot)
  })
})

describe('snapshot identity', () => {
  it('preserves the references of fields the patch did not change', () => {
    const store = new ShellStateStore(initialState())
    const before = store.getSnapshot()

    store.apply({ theme: 'dark' })
    const after = store.getSnapshot()

    expect(after.user).toBe(before.user)
    expect(after.groups).toBe(before.groups)
    expect(after.theme).toBe('dark')
  })

  it('keeps the groups reference when an equal array is supplied', () => {
    const store = new ShellStateStore(initialState())
    const before = store.getGroups()

    const change = store.apply({ groups: ['analysts', 'viewers'] })

    expect(store.getGroups()).toBe(before)
    expect(change.changed).toEqual([])
  })

  it('returns no changes and notifies nobody for a patch that changes nothing', () => {
    const store = new ShellStateStore(initialState())
    const listeners = watchAllFields(store)
    const observer = vi.fn()
    store.observeTransitions(observer)
    const before = store.getSnapshot()

    // re-supplying the very same values, as a re-render would.
    const change = store.apply({
      user: { ...ADA },
      groups: ['analysts', 'viewers'],
      theme: 'light',
    })

    expect(change.changed).toEqual([])
    expect(change.transitions).toEqual([])
    expect(change.previous).toBe(before)
    expect(change.next).toBe(before)
    expect(store.getSnapshot()).toBe(before)
    expect(observer).not.toHaveBeenCalled()
    for (const field of SHELL_STATE_FIELDS) {
      expect(listenerFor(listeners, field)).not.toHaveBeenCalled()
    }
  })

  it('copies and freezes the groups it was constructed with', () => {
    const groups = ['analysts']
    const store = new ShellStateStore(initialState({ groups }))

    groups.push('smuggled')

    expect(store.getGroups()).toEqual(['analysts'])
    expect(Object.isFrozen(store.getGroups())).toBe(true)
  })
})

describe('transition classification', () => {
  it('classifies a theme change as a theme transition only', () => {
    const store = new ShellStateStore(initialState())

    const change = store.apply({ theme: 'dark' })

    expect(change.changed).toEqual(['theme'])
    expect(change.transitions).toEqual([{ kind: 'theme' }])
  })

  it('classifies a token refresh without any field change', () => {
    const store = new ShellStateStore(initialState())

    const change = store.apply({}, { tokenRefresh: true })

    expect(change.changed).toEqual([])
    expect(change.transitions).toEqual([{ kind: 'token-refresh' }])
  })

  it('classifies arriving at a signed-in user as a login', () => {
    const store = new ShellStateStore(initialState({ user: null }))

    const change = store.apply({ user: ADA })

    expect(change.transitions).toEqual([{ kind: 'identity', reason: 'login' }])
  })

  it('classifies losing the user as a logout', () => {
    const store = new ShellStateStore(initialState())

    const change = store.apply({ user: null })

    expect(change.transitions).toEqual([{ kind: 'identity', reason: 'logout' }])
  })

  it('classifies a different principal as a login', () => {
    const store = new ShellStateStore(initialState())

    const change = store.apply({ user: { ...ADA, id: 'user-2' } })

    expect(change.transitions).toEqual([{ kind: 'identity', reason: 'login' }])
  })

  it('classifies a tenant switch for the same principal as a tenant transition', () => {
    const store = new ShellStateStore(initialState())

    const change = store.apply({ user: { ...ADA, tenantId: 'tenant-2' } })

    expect(change.transitions).toEqual([{ kind: 'identity', reason: 'tenant' }])
  })

  it('classifies an account switch for the same principal as an account transition', () => {
    const store = new ShellStateStore(initialState())

    const change = store.apply({ user: { ...ADA, accountId: 'account-2' } })

    expect(change.transitions).toEqual([{ kind: 'identity', reason: 'account' }])
  })

  it('does not treat a renamed display name on the same principal as an identity change', () => {
    const store = new ShellStateStore(initialState())

    // the same id, account and tenant; only the rendered name differs.
    const change = store.apply({ user: { ...ADA, name: 'Ada King' } })

    // the field changed so UI re-renders, but nothing is retired.
    expect(change.changed).toEqual(['user'])
    expect(change.transitions).toEqual([])
    expect(requiresSessionRetirement(change.transitions)).toBe(false)
  })

  it('does not raise a groups transition when an identical group set is merely reordered', () => {
    const store = new ShellStateStore(initialState({ groups: ['analysts', 'viewers'] }))

    const change = store.apply({ groups: ['viewers', 'analysts'] })

    // the set is the same, so no permission change happened.
    expect(change.transitions).toEqual([])
    expect(requiresSessionRetirement(change.transitions)).toBe(false)
    expect(store.getGroups()).toEqual(['viewers', 'analysts'])
  })

  it('raises a groups transition when a group is added', () => {
    const store = new ShellStateStore(initialState({ groups: ['analysts'] }))

    const change = store.apply({ groups: ['analysts', 'admins'] })

    expect(change.transitions).toEqual([{ kind: 'groups' }])
  })

  it('raises a groups transition when a group is removed', () => {
    const store = new ShellStateStore(initialState({ groups: ['analysts', 'admins'] }))

    const change = store.apply({ groups: ['analysts'] })

    expect(change.transitions).toEqual([{ kind: 'groups' }])
  })

  it('raises a groups transition when a group is swapped for another of the same count', () => {
    const store = new ShellStateStore(initialState({ groups: ['analysts', 'admins'] }))

    const change = store.apply({ groups: ['analysts', 'auditors'] })

    expect(change.transitions).toEqual([{ kind: 'groups' }])
  })

  it('reports every transition a combined patch produced', () => {
    const store = new ShellStateStore(initialState({ user: null, groups: [], theme: 'light' }))

    const change = store.apply(
      { user: ADA, groups: ['analysts'], theme: 'dark' },
      { tokenRefresh: true },
    )

    expect(change.changed).toEqual(['user', 'groups', 'theme'])
    expect(change.transitions).toEqual([
      { kind: 'token-refresh' },
      { kind: 'identity', reason: 'login' },
      { kind: 'groups' },
      { kind: 'theme' },
    ])
  })
})

describe('requiresSessionRetirement', () => {
  it('requires retirement for identity and semantic group changes', () => {
    expect(requiresSessionRetirement([{ kind: 'identity', reason: 'login' }])).toBe(true)
    expect(requiresSessionRetirement([{ kind: 'identity', reason: 'logout' }])).toBe(true)
    expect(requiresSessionRetirement([{ kind: 'identity', reason: 'account' }])).toBe(true)
    expect(requiresSessionRetirement([{ kind: 'identity', reason: 'tenant' }])).toBe(true)
    expect(requiresSessionRetirement([{ kind: 'groups' }])).toBe(true)
  })

  it('does not require retirement for theme or token refresh changes', () => {
    expect(requiresSessionRetirement([])).toBe(false)
    expect(requiresSessionRetirement([{ kind: 'theme' }])).toBe(false)
    expect(requiresSessionRetirement([{ kind: 'token-refresh' }])).toBe(false)
    expect(requiresSessionRetirement([{ kind: 'token-refresh' }, { kind: 'theme' }])).toBe(false)
  })
})

describe('transition observers', () => {
  it('runs host observers before field listeners see the new state', () => {
    // the host has to be able to retire session-dependent work before
    // any UI renders against the new identity.
    const store = new ShellStateStore(initialState())
    const order: string[] = []
    store.observeTransitions(() => order.push('observer'))
    store.subscribeToField('user', () => order.push('user-listener'))
    store.subscribeToField('groups', () => order.push('groups-listener'))

    store.apply({ user: { ...ADA, id: 'user-2' }, groups: ['admins'] })

    expect(order).toEqual(['observer', 'user-listener', 'groups-listener'])
  })

  it('hands the observer the previous state, the next state and the classification', () => {
    const store = new ShellStateStore(initialState())
    const before = store.getSnapshot()
    const seen: ShellStateChange[] = []
    store.observeTransitions(change => seen.push(change))

    store.apply({ theme: 'dark' })

    const [change] = seen
    expect(change).toBeDefined()
    expect(change?.previous).toBe(before)
    expect(change?.next).toBe(store.getSnapshot())
    expect(change?.next.theme).toBe('dark')
    expect(change?.previous.theme).toBe('light')
  })

  it('notifies a token refresh observer without notifying any field listener', () => {
    const store = new ShellStateStore(initialState())
    const listeners = watchAllFields(store)
    const observer = vi.fn()
    store.observeTransitions(observer)

    store.apply({}, { tokenRefresh: true })

    expect(observer).toHaveBeenCalledTimes(1)
    for (const field of SHELL_STATE_FIELDS) {
      expect(listenerFor(listeners, field)).not.toHaveBeenCalled()
    }
  })

  it('stops calling an observer once it unsubscribes', () => {
    const store = new ShellStateStore(initialState())
    const observer = vi.fn()
    const unsubscribe = store.observeTransitions(observer)

    store.apply({ theme: 'dark' })
    unsubscribe()
    store.apply({ theme: 'light' })

    expect(observer).toHaveBeenCalledTimes(1)
  })

  it('drops observers and field listeners on disposal', () => {
    const store = new ShellStateStore(initialState())
    const observer = vi.fn()
    const listener = vi.fn()
    store.observeTransitions(observer)
    store.subscribeToField('theme', listener)

    store.dispose()
    store.apply({ theme: 'dark' })

    expect(observer).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    expect(store.fieldListenerCount('theme')).toBe(0)
  })
})
