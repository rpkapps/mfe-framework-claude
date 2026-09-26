/**
 * The canvas decides how many columns there are, so it is measured rather than assumed. Apart from
 * the page, so the page's module exports only its component and this runs under test without the
 * design system.
 */

import { useEffect, useState } from 'react'

import { columnsIn } from './grid.ts'

export interface CanvasColumns {
  /** A callback ref for the canvas's surface: the observer follows whichever element it is now. */
  readonly surfaceRef: (element: HTMLDivElement | null) => void
  /**
   * `null` until the canvas has a width: the first paint reports zero, and treating that as a real
   * canvas would fit every tile down to the minimum.
   */
  readonly measured: number | null
}

/**
 * The surface is held as state, not in a ref object: the canvas mounts anew when the page crosses
 * the compact breakpoint, and an observer set up once would go on watching the element that left.
 */
export function useCanvasColumns(): CanvasColumns {
  const [surface, setSurface] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (surface === null) return

    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(surface)
    return () => {
      observer.disconnect()
    }
  }, [surface])

  return { surfaceRef: setSurface, measured: width === 0 ? null : columnsIn(width) }
}
