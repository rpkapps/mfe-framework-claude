/** Geometry only, so the panel's layout is testable without a DOM. */

import type { CSSProperties } from 'react'
import type { DevtoolsSide } from '../devtools-settings.ts'

/** In the order they sit on screen, so the dock control reads as a picture rather than a list of four positions. */
export const SIDES: readonly DevtoolsSide[] = ['left', 'top', 'bottom', 'right']

/** True when the side is resized by height rather than width. */
export function isHorizontal(side: DevtoolsSide): boolean {
  return side === 'top' || side === 'bottom'
}

/** The cross axis is always the full viewport, which is what makes a docked panel read as docked. */
export function dockStyle(side: DevtoolsSide, size: number): CSSProperties {
  const extent = `${String(size)}px`

  switch (side) {
    case 'top':
      return { top: 0, left: 0, right: 0, height: extent }
    case 'bottom':
      return { bottom: 0, left: 0, right: 0, height: extent }
    case 'left':
      return { top: 0, bottom: 0, left: 0, width: extent }
    case 'right':
      return { top: 0, bottom: 0, right: 0, width: extent }
  }
}

/**
 * The resize strip, centred on the seam between the panel and the page rather than placed inside
 * the panel: a `Panel` clips its own overflow, so a grip drawn within it can only ever sit to one
 * side of the edge it is supposed to straddle.
 */
export function handleStyle(side: DevtoolsSide, size: number): CSSProperties {
  const seam = `${String(size)}px`

  switch (side) {
    case 'top':
      return { top: seam, left: 0, right: 0, transform: 'translateY(-50%)' }
    case 'bottom':
      return { bottom: seam, left: 0, right: 0, transform: 'translateY(50%)' }
    case 'left':
      return { left: seam, top: 0, bottom: 0, transform: 'translateX(-50%)' }
    case 'right':
      return { right: seam, top: 0, bottom: 0, transform: 'translateX(50%)' }
  }
}

/** The size a drag to `position` implies, in px from the panel's own edge; `viewport` is that axis in full. */
export function sizeFromPointer(side: DevtoolsSide, position: number, viewport: number): number {
  switch (side) {
    case 'top':
    case 'left':
      return position
    case 'bottom':
    case 'right':
      return viewport - position
  }
}

/** The edge the handle sits on: the one facing the page. */
export function handleSide(side: DevtoolsSide): DevtoolsSide {
  switch (side) {
    case 'top':
      return 'bottom'
    case 'bottom':
      return 'top'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
  }
}
