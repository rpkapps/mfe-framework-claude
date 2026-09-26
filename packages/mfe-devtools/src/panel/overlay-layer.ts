/** Overlays are `z-50` and portal into `document.body`, so one opened inside the panel rendered behind it. */

import { useEffect, useState } from 'react'

/** One step above the panel, which is itself above the page. */
const OVERLAY_Z_INDEX = '2147483001'

/**
 * The element rather than a getter: the provider resolves a getter once, after its own commit,
 * which comes before the effect below — so it read `null` and the overlays stayed behind the
 * panel. Created on the first render and attached by the effect, so the provider has the element
 * from the start and the document only gains the node while the dock is open.
 */
export function useOverlayLayer(): HTMLElement {
  const [layer] = useState(() => {
    const element = document.createElement('div')
    element.dataset['mfeDevtoolsOverlays'] = ''
    // A stacking context and nothing else, so nothing here intercepts a pointer.
    element.style.position = 'relative'
    element.style.zIndex = OVERLAY_Z_INDEX
    return element
  })

  useEffect(() => {
    document.body.append(layer)
    return () => {
      layer.remove()
    }
  }, [layer])

  return layer
}
