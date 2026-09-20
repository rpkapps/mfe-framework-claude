/**
 * The panel chunk, fetched the first time the tool is on and never before.
 *
 * A module-scope promise rather than `React.lazy`, matching how the framework
 * already defers a module: `remote-definition.ts` caches the promise so React
 * is handed the *same* settled promise every render — a cache that dropped a
 * rejection would hand the next render a fresh pending one, which suspends
 * forever and refetches as fast as the network allows.
 *
 * The dynamic specifier is the whole code-splitting boundary, so nothing else
 * in this package may import the panel statically. `src/index.ts` exports the
 * mount and the flag API only; a re-export of the panel there would put it back
 * in the initial chunk and make this file decorative.
 */

import type { ComponentType } from 'react'

export interface DevtoolsPanelModule {
  readonly DevtoolsPanel: ComponentType
}

let pending: Promise<DevtoolsPanelModule> | null = null

export function loadPanel(): Promise<DevtoolsPanelModule> {
  if (pending) return pending

  const load = import('./panel/devtools-panel.tsx')
  // Marks the rejection handled without dropping it, so a failed fetch does not
  // surface as an unhandled rejection before a consumer suspends on it.
  load.catch(() => {})
  pending = load
  return load
}

/** Drops the cached module, so a retry refetches. Tests use this too. */
export function forgetPanel(): void {
  pending = null
}
