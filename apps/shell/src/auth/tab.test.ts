import { describe, expect, it } from 'vitest'

import { claimTab, type TabLocks } from './tab.ts'

/** Locks shared by every "tab" in a test, as one browser profile's are. */
function browserLocks(): TabLocks {
  const held = new Set<string>()
  return {
    request(name, _options, callback) {
      if (held.has(name)) return Promise.resolve(callback(null))
      held.add(name)
      return Promise.resolve(callback({ name }))
    },
  }
}

function tabStorage(entries: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(entries))
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

describe('claimTab', () => {
  it('makes a new tab the owner of a new id', async () => {
    const storage = tabStorage()
    expect(await claimTab(storage, browserLocks(), () => 'a')).toBe('owner')
    expect(storage.getItem('shell.tab')).toBe('a')
  })

  it('keeps a reloaded tab the owner of its id', async () => {
    const storage = tabStorage({ 'shell.tab': 'a' })
    expect(await claimTab(storage, browserLocks(), () => 'b')).toBe('owner')
    expect(storage.getItem('shell.tab')).toBe('a')
  })

  it('finds a duplicated tab to be a copy, and gives it an id of its own', async () => {
    const locks = browserLocks()
    const original = tabStorage()
    await claimTab(original, locks, () => 'a')

    // Duplicating copies the original's sessionStorage, id included.
    const duplicate = tabStorage({ 'shell.tab': 'a' })
    expect(await claimTab(duplicate, locks, () => 'b')).toBe('copy')
    expect(duplicate.getItem('shell.tab')).toBe('b')

    // Reloading the duplicate afterwards is an ordinary reload.
    expect(await claimTab(tabStorage({ 'shell.tab': 'b' }), browserLocksWith('a'))).toBe('owner')
  })

  it('takes the tab as the owner where there are no Web Locks', async () => {
    expect(await claimTab(tabStorage({ 'shell.tab': 'a' }), undefined)).toBe('owner')
  })
})

/** Locks where other tabs already hold the given ids. */
function browserLocksWith(...ids: string[]): TabLocks {
  const locks = browserLocks()
  for (const id of ids) void locks.request(`shell.tab:${id}`, { ifAvailable: true }, () => {})
  return locks
}
