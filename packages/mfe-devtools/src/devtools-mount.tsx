/**
 * The devtools, mounted unconditionally by a host and costing almost nothing.
 *
 * This module ships in every build, production included, because the flag it
 * reads is the point: a deployed shell is exactly where you want to be able to
 * repoint a container without a rebuild. `DEV` would fold to `false` there and
 * delete the feature, so it is deliberately not used.
 *
 * What that buys has to stay small, and it is: a storage read and `null`. The
 * panel — every component, every design-system subpath it reaches for — is
 * behind the dynamic import in `load-panel.ts` and is fetched the first time
 * the flag is on, never before.
 *
 * Every export here is a component. React Refresh only replaces a module in
 * place when it can prove that, and the store and the loader beside this file
 * are why it can.
 */

import { Suspense, use, useSyncExternalStore, type ReactNode } from 'react'

import { devtools, initDevtools } from './devtools-store.ts'
import { loadPanel } from './load-panel.ts'

/**
 * The trigger and the panel, or nothing.
 *
 * A host renders this once, beside its other page-level surfaces. It takes no
 * props: everything it needs is either in the runtime it reads through context
 * or in the store beside it, and a prop would only be a second way to say the
 * same thing.
 */
export function MfeDevtools(): ReactNode {
  /*
   * Reads storage and the query parameter once, on the way into the first
   * render. Not as `useSyncExternalStore`'s third argument: that one is the
   * hydration snapshot and is never called in a browser, so passing it there
   * left the flag reading as its default and the tool permanently off.
   * `initDevtools` is idempotent, which is what makes calling it here safe
   * under StrictMode's double render.
   */
  initDevtools()
  const { on } = useSyncExternalStore(devtools.subscribe, devtools.getSnapshot)

  if (!on) return null

  /*
   * The boundary is local and its fallback is nothing. A suspension is caught
   * by the nearest boundary above it, and without one here that is whatever the
   * host page happens to have — which would replace the application with a
   * loading state while a developer tool fetches itself.
   */
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
