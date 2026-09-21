/** Overlays are `z-50` and portal into `document.body`, so one opened inside the panel rendered behind it. */

import { useCallback, useEffect, useRef } from 'react'

/** One step above the panel, which is itself above the page. */
const OVERLAY_Z_INDEX = '2147483001'

export function useOverlayLayer(): () => HTMLElement | null {
  const layer = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const element = document.createElement('div')
    element.dataset['mfeDevtoolsOverlays'] = ''
    // A stacking context and nothing else, so nothing here intercepts a pointer.
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
