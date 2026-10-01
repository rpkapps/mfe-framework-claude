import { useSyncExternalStore } from 'react'

type Framework = 'React' | 'Angular'

const storageKey = 'mfe-docs:framework'
let framework: Framework = 'React'
let initialized = false
const listeners = new Set<() => void>()

function update(value: Framework) {
  if (value === framework) return
  framework = value
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Read after hydration, so the server and initial client render both select React.
  if (!initialized) {
    initialized = true
    try {
      // Standalone docs site: there is no MFE mount or storage adapter here.
      // eslint-disable-next-line mfe/no-raw-storage
      const stored = window.localStorage.getItem(storageKey)
      if (stored === 'React' || stored === 'Angular') update(stored)
    } catch {
      // Sandboxed/private browsers can deny storage; selection still works in memory.
    }
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return
    if (event.newValue === 'React' || event.newValue === 'Angular') update(event.newValue)
    else if (event.newValue === null) update('React')
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useFrameworkPreference() {
  return useSyncExternalStore(
    subscribe,
    () => framework,
    () => 'React' as const,
  )
}

export function selectFramework(value: Framework) {
  update(value)
  try {
    // Standalone docs preference, namespaced and guarded against denied storage.
    // eslint-disable-next-line mfe/no-raw-storage
    window.localStorage.setItem(storageKey, value)
  } catch {
    // Keep the in-memory preference when storage is unavailable.
  }
}
