/** The panel chunk, cached rather than rebuilt per call: `use` suspends again on any promise it has not seen. */

import type { ComponentType } from 'react'

export interface DevtoolsPanelModule {
  readonly DevtoolsPanel: ComponentType
}

let pending: Promise<DevtoolsPanelModule> | null = null

export function loadPanel(): Promise<DevtoolsPanelModule> {
  if (pending) return pending

  const load = import('./panel/devtools-panel.tsx')
  // A failed fetch is forgotten, so the next mount fetches again rather than failing for good. The
  // handler also marks the rejection handled without dropping it from `load`.
  load.catch(() => {
    if (pending === load) pending = null
  })
  pending = load
  return load
}

/** Drops the cached module, so a retry refetches. */
export function forgetPanel(): void {
  pending = null
}
