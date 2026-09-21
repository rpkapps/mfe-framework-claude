import { describe, expect, it, vi } from 'vitest'

import type { BreadcrumbItem } from '@company/mfe-core'

import { BreadcrumbStore } from './breadcrumb-store.ts'
import { recordingDiagnostics } from '../__tests__/harness.ts'

function crumb(key: string, label = key): BreadcrumbItem {
  return { key, label, href: `/${key}` }
}

function keysOf(items: readonly BreadcrumbItem[]): readonly string[] {
  return items.map(item => item.key)
}

describe('composition', () => {
  it('starts with an empty trail', () => {
    const store = new BreadcrumbStore()

    expect(store.getSnapshot()).toEqual([])
    expect(store.contributionCount).toBe(0)
  })

  it('orders contributions parent to child by depth', () => {
    // the nested App registers before its parent, so only depth can produce the right
    // order.
    const store = new BreadcrumbStore()
    const child = store.registerMount('report-detail', 'mount-child', 2)
    const parent = store.registerMount('reports', 'mount-parent', 1)

    child.update([crumb('detail')])
    parent.update([crumb('reports')])

    expect(keysOf(store.getSnapshot())).toEqual(['reports', 'detail'])
  })

  it('keeps siblings at the same depth in registration order', () => {
    const store = new BreadcrumbStore()
    const first = store.registerMount('reports', 'mount-1', 1)
    const second = store.registerMount('billing', 'mount-2', 1)

    second.update([crumb('billing')])
    first.update([crumb('reports')])

    expect(keysOf(store.getSnapshot())).toEqual(['reports', 'billing'])
  })

  it('concatenates every item a mount contributed', () => {
    const store = new BreadcrumbStore()
    const reports = store.registerMount('reports', 'mount-1', 1)

    reports.update([
      crumb('reports'),
      crumb('quarterly'),
      { key: 'q3', label: 'Q3', current: true },
    ])

    expect(keysOf(store.getSnapshot())).toEqual(['reports', 'quarterly', 'q3'])
    expect(store.getSnapshot()[2]?.current).toBe(true)
  })

  it('notifies subscribers when the composed trail changes', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    const subscriber = vi.fn()
    store.subscribe(subscriber)

    handle.update([crumb('reports')])

    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it('exposes stable subscribe and snapshot references', () => {
    const store = new BreadcrumbStore()

    expect(store.getSnapshot).toBe(store.getSnapshot)
    expect(store.subscribe).toBe(store.subscribe)
  })
})

describe('equal contributions', () => {
  it('keeps the published trail and notifies nobody when equal items are supplied again', () => {
    // the router re-renders and hands over a fresh array holding equal records, as it does
    // for unrelated state such as fetch status.
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports'), crumb('quarterly')])
    const published = store.getSnapshot()
    const subscriber = vi.fn()
    store.subscribe(subscriber)

    handle.update([crumb('reports'), crumb('quarterly')])

    expect(store.getSnapshot()).toBe(published)
    expect(subscriber).not.toHaveBeenCalled()
  })

  it('keeps the published trail when a mount re-supplies an equal override', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports')])
    store.setOverride('mount-1', [crumb('wizard'), crumb('step-1')], 'owner-a')
    const published = store.getSnapshot()
    const subscriber = vi.fn()
    store.subscribe(subscriber)

    store.setOverride('mount-1', [crumb('wizard'), crumb('step-1')], 'owner-a')

    expect(store.getSnapshot()).toBe(published)
    expect(subscriber).not.toHaveBeenCalled()
  })

  it('republishes when a single label actually changed', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports', 'Reports')])
    const subscriber = vi.fn()
    store.subscribe(subscriber)

    handle.update([crumb('reports', 'All reports')])

    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()[0]?.label).toBe('All reports')
  })
})

describe('overrides', () => {
  it('replaces only the overriding mount’s own portion of the trail', () => {
    const store = new BreadcrumbStore()
    const parent = store.registerMount('reports', 'mount-parent', 1)
    const child = store.registerMount('report-detail', 'mount-child', 2)
    parent.update([crumb('reports')])
    child.update([crumb('detail')])

    store.setOverride('mount-child', [crumb('wizard'), crumb('step-1')], 'owner-a')

    expect(keysOf(store.getSnapshot())).toEqual(['reports', 'wizard', 'step-1'])
  })

  it('restores the route-derived items when the owner clears its override', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports')])
    store.setOverride('mount-1', [crumb('wizard')], 'owner-a')

    store.clearOverride('mount-1', 'owner-a')

    expect(keysOf(store.getSnapshot())).toEqual(['reports'])
  })

  it('ignores a clear request from a token that does not own the override', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports')])
    store.setOverride('mount-1', [crumb('wizard')], 'owner-a')

    store.clearOverride('mount-1', 'owner-b')

    expect(keysOf(store.getSnapshot())).toEqual(['wizard'])
  })

  it('lets the owning component update its own override freely', () => {
    const store = new BreadcrumbStore()
    store.registerMount('reports', 'mount-1', 1)
    store.setOverride('mount-1', [crumb('wizard'), crumb('step-1')], 'owner-a')

    store.setOverride('mount-1', [crumb('wizard'), crumb('step-2')], 'owner-a')

    expect(keysOf(store.getSnapshot())).toEqual(['wizard', 'step-2'])
  })

  it('refuses a competing override from a different owner and diagnoses it', () => {
    const { hub, records } = recordingDiagnostics()
    const store = new BreadcrumbStore({ diagnostics: hub })
    store.registerMount('reports', 'mount-1', 1)
    store.setOverride('mount-1', [crumb('wizard'), crumb('step-1')], 'owner-a')
    const published = store.getSnapshot()

    store.setOverride('mount-1', [crumb('other-flow')], 'owner-b')

    expect(store.getSnapshot()).toBe(published)
    expect(keysOf(store.getSnapshot())).toEqual(['wizard', 'step-1'])
    expect(records).toHaveLength(1)
    expect(records[0]?.severity).toBe('warning')
    expect(records[0]?.error.code).toBe('app/invalid-router')
    expect(records[0]?.error.message).toContain('at most one active breadcrumb override')
  })

  it('ignores an override for a mount that never registered', () => {
    const store = new BreadcrumbStore()

    store.setOverride('mount-unknown', [crumb('wizard')], 'owner-a')

    expect(store.getSnapshot()).toEqual([])
  })
})

describe('navigation', () => {
  it('clears the active override so a flow does not leak into the next route', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports')])
    store.setOverride('mount-1', [crumb('wizard'), crumb('step-3')], 'owner-a')

    store.notifyNavigation('mount-1')

    expect(keysOf(store.getSnapshot())).toEqual(['reports'])
  })

  it('does not let the previous owner reinstall its override after a navigation', () => {
    // a hook that somehow outlived the navigation tries again.
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports')])
    store.setOverride('mount-1', [crumb('wizard'), crumb('step-3')], 'owner-a')
    store.notifyNavigation('mount-1')

    store.setOverride('mount-1', [crumb('wizard'), crumb('step-3')], 'owner-a')

    expect(keysOf(store.getSnapshot())).toEqual(['reports'])
  })

  it('lets a freshly mounted owner install an override after a navigation', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports')])
    store.setOverride('mount-1', [crumb('wizard')], 'owner-a')
    store.notifyNavigation('mount-1')

    store.setOverride('mount-1', [crumb('editor')], 'owner-b')

    expect(keysOf(store.getSnapshot())).toEqual(['editor'])
  })

  it('leaves other mounts alone when one mount navigates', () => {
    const store = new BreadcrumbStore()
    const parent = store.registerMount('reports', 'mount-parent', 1)
    const child = store.registerMount('report-detail', 'mount-child', 2)
    parent.update([crumb('reports')])
    child.update([crumb('detail')])
    store.setOverride('mount-parent', [crumb('parent-flow')], 'owner-a')
    store.setOverride('mount-child', [crumb('child-flow')], 'owner-b')

    store.notifyNavigation('mount-child')

    expect(keysOf(store.getSnapshot())).toEqual(['parent-flow', 'detail'])
  })

  it('does not republish when a navigation had no override to clear', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports')])
    const published = store.getSnapshot()
    const subscriber = vi.fn()
    store.subscribe(subscriber)

    store.notifyNavigation('mount-1')

    expect(store.getSnapshot()).toBe(published)
    expect(subscriber).not.toHaveBeenCalled()
  })

  it('ignores a navigation notice for a mount that never registered', () => {
    const store = new BreadcrumbStore()

    expect(() => store.notifyNavigation('mount-unknown')).not.toThrow()
  })
})

describe('removal', () => {
  it('drops a contribution and recomposes the remaining ones', () => {
    const store = new BreadcrumbStore()
    const parent = store.registerMount('reports', 'mount-parent', 1)
    const child = store.registerMount('report-detail', 'mount-child', 2)
    parent.update([crumb('reports')])
    child.update([crumb('detail')])

    child.remove()

    expect(keysOf(store.getSnapshot())).toEqual(['reports'])
    expect(store.contributionCount).toBe(1)
  })

  it('ignores updates from a removed handle', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports')])
    handle.remove()

    handle.update([crumb('resurrected')])

    expect(store.getSnapshot()).toEqual([])
    expect(store.contributionCount).toBe(0)
  })

  it('returns to the empty trail when the last contribution leaves', () => {
    const store = new BreadcrumbStore()
    const empty = store.getSnapshot()
    const handle = store.registerMount('reports', 'mount-1', 1)
    handle.update([crumb('reports')])

    handle.remove()

    expect(store.getSnapshot()).toBe(empty)
  })

  it('drops every contribution and subscriber on disposal', () => {
    const store = new BreadcrumbStore()
    const handle = store.registerMount('reports', 'mount-1', 1)
    const subscriber = vi.fn()
    store.subscribe(subscriber)

    store.dispose()
    handle.update([crumb('reports')])

    expect(store.contributionCount).toBe(0)
    expect(subscriber).not.toHaveBeenCalled()
  })
})
