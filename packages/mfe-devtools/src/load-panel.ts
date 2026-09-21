/** The panel chunk, cached rather than rebuilt per call: `use` suspends again on any promise it has not seen. */

import type { ComponentType } from 'react'

export interface DevtoolsPanelModule {
  readonly DevtoolsPanel: ComponentType
}

let pending: Promise<DevtoolsPanelModule> | null = null

export function loadPanel(): Promise<DevtoolsPanelModule> {
  if (pending) return pending

  const load = import('./panel/devtools-panel.tsx')
  // Marks the rejection handled without dropping it, so a failed fetch is not an unhandled rejection.
  load.catch(() => {})
  pending = load
  return load
}

/** Drops the cached module, so a retry refetches. */
export function forgetPanel(): void {
  pending = null
}
