/**
 * The devtools mount ships in every build and is gated at runtime, because `DEV` would delete the
 * feature on exactly the deployed page where repointing a container matters (§22).
 */

import { Suspense, use, useSyncExternalStore, type ReactNode } from 'react'

import { devtools, initDevtools } from './devtools-store.ts'
import { loadPanel } from './load-panel.ts'

export function MfeDevtools(): ReactNode {
  // Not as `useSyncExternalStore`'s third argument: that one is the hydration snapshot, never called in a browser.
  initDevtools()
  const { on } = useSyncExternalStore(devtools.subscribe, devtools.getSnapshot)

  if (!on) return null

  return (
    <Suspense fallback={null}>
      <PanelChunk />
    </Suspense>
  )
}

function PanelChunk(): ReactNode {
  const { DevtoolsPanel } = use(loadPanel())
  return <DevtoolsPanel />
}
