/**
 * An in-memory navigation bridge that keeps its own entry list, so back and forward behave
 * like a browser without touching one.
 */

import type { BoundaryLocation, NavigationBridge } from '@company/mfe-core'

import { parseBoundaryLocation } from '../navigation/boundary-navigator.ts'

interface MemoryEntry {
  location: BoundaryLocation
  state: unknown
}

export function createMemoryNavigationBridge(
  initialEntries: readonly string[] = ['/'],
): NavigationBridge & { readonly entries: readonly string[] } {
  const entries: MemoryEntry[] = (initialEntries.length > 0 ? initialEntries : ['/']).map(
    (entry, position) => ({
      location: parseBoundaryLocation(entry),
      state: { __TSR_index: position },
    }),
  )

  let cursor = entries.length - 1
  const listeners = new Set<(location: BoundaryLocation) => void>()

  const currentEntry = (): MemoryEntry => {
    const entry = entries[cursor]
    if (!entry) throw new Error('Memory navigation bridge has no current entry')
    return entry
  }

  const notify = (): void => {
    const { location } = currentEntry()
    for (const listener of [...listeners]) listener(location)
  }

  return {
    get entries() {
      return entries.map(entry => `${entry.location.pathname}${entry.location.search}`)
    },

    read: () => currentEntry().location,
    readState: () => currentEntry().state,

    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    push: (to, state) => {
      entries.splice(cursor + 1)
      entries.push({ location: parseBoundaryLocation(to), state })
      cursor = entries.length - 1
    },

    replace: (to, state) => {
      entries[cursor] = { location: parseBoundaryLocation(to), state }
    },

    back: () => {
      if (cursor === 0) return
      cursor -= 1
      notify()
    },

    forward: () => {
      if (cursor >= entries.length - 1) return
      cursor += 1
      notify()
    },

    go: delta => {
      const next = Math.min(Math.max(cursor + delta, 0), entries.length - 1)
      if (next === cursor) return
      cursor = next
      notify()
    },

    reload: () => notify(),
  }
}
