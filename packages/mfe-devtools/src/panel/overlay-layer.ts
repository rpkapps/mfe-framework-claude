/**
 * Where the panel's overlays render.
 *
 * Every design-system overlay is `z-50` and portals into `document.body`,
 * while the panel sits at the top of the stack so a host page cannot bury it.
 * A menu opened inside the panel therefore rendered *behind* it and read as a
 * dead button. `PortalProvider` is the answer the design system documents for
 * this, and it wants a container at body level: portalling into the panel
 * would hand the overlays back to its `overflow: hidden`.
 *
 * A hook in a module of its own, because appending a node to the body is the
 * one thing this package does to a document it does not own — worth being able
 * to assert on without standing up a panel, and worth noticing if it ever
 * stops being cleaned up.
 */

import { useCallback, useEffect, useRef } from 'react'

/** One step above the panel, which is itself above the page. */
const OVERLAY_Z_INDEX = '2147483001'

/**
 * A getter rather than the node itself, which is what `PortalProvider` takes.
 *
 * The node cannot exist before the effect that appends it, and putting it in
 * state to announce its arrival would mean a second render of the whole panel
 * for a value nothing reads until an overlay opens. The getter is stable, the
 * ref is current by the time any overlay asks, and no render is spent on it.
 */
export function useOverlayLayer(): () => HTMLElement | null {
  const layer = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const element = document.createElement('div')
    element.dataset['mfeDevtoolsOverlays'] = ''
    /*
     * A stacking context and nothing else: `relative` with no box of its own,
     * so there is nothing to intercept a pointer and the fixed-positioned
     * overlays inside it still measure against the viewport.
     */
    element.style.position = 'relative'
    element.style.zIndex = OVERLAY_Z_INDEX
    document.body.append(element)
    layer.current = element

    return () => {
      element.remove()
      layer.current = null
    }
  }, [])

  return useCallback(() => layer.current, [])
}
