/**
 * Where a docked panel sits, and which way its resize handle drags.
 *
 * Geometry only, so the panel's layout is testable without a DOM and the
 * component above it stays a component.
 */

import type { CSSProperties } from 'react'
import type { DevtoolsSide } from '../devtools-settings.ts'

/**
 * The order the dock control offers them in, which is the order they sit in on
 * screen read left to right: the two vertical docks on the outside, the two
 * horizontal ones between. Offering them clockwise from the top made the
 * buttons a list of four positions rather than a picture of where the panel
 * goes.
 */
export const SIDES: readonly DevtoolsSide[] = ['left', 'top', 'bottom', 'right']

/** True when the side is resized by height rather than width. */
export function isHorizontal(side: DevtoolsSide): boolean {
  return side === 'top' || side === 'bottom'
}

/**
 * The panel's own box. Fixed to one edge and sized on the one axis that
 * matters; the cross axis is always the full viewport, which is what makes a
 * docked panel read as docked rather than as a floating window.
 */
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
 * The size a drag to `position` implies, in px from the panel's own edge.
 * `viewport` is the full extent on that axis.
 */
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
