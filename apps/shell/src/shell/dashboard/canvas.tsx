/**
 * The work surface tiles are placed on. Tecton's `Canvas` gives the full-bleed area and the
 * floating chrome; the dots are drawn here because they are not decoration — their spacing is
 * the snap unit, so they have to come from the same constant the placement maths uses.
 */

import type { ReactNode } from 'react'
import { Canvas, CanvasSurface } from '@tecton/react/tecton/canvas'

import { CELL } from './grid.ts'

/**
 * A repeating radial gradient rather than one of Tecton's `Background` effects: those draw a
 * themed texture at their own scale, where this has to land exactly on the cells.
 */
const DOTS = {
  backgroundImage:
    'radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--foreground) 22%, transparent) 1px, transparent 0)',
  backgroundSize: `${String(CELL)}px ${String(CELL)}px`,
} as const

export interface DashboardCanvasProps {
  readonly children: ReactNode
  /** Drawn brighter while a drag is over it, so a drop target is not a guess. */
  readonly isDropTarget?: boolean
  /** A tile is being moved or resized: the surface stops selecting text under the pointer. */
  readonly isGesturing?: boolean
  readonly label: string
  readonly onDragOver?: (event: React.DragEvent) => void
  readonly onDragLeave?: (event: React.DragEvent) => void
  readonly onDrop?: (event: React.DragEvent) => void
  /** Measured by the caller, which owns the column count the tiles are placed against. */
  readonly surfaceRef?: React.Ref<HTMLDivElement>
  /** Floating controls, pinned by their own `CanvasOverlay`. */
  readonly overlay?: ReactNode
}

export function DashboardCanvas({
  children,
  isDropTarget = false,
  isGesturing = false,
  label,
  onDragOver,
  onDragLeave,
  onDrop,
  surfaceRef,
  overlay,
}: DashboardCanvasProps): ReactNode {
  return (
    <Canvas
      aria-label={label}
      data-drop-target={isDropTarget ? '' : undefined}
      className="rounded-lg border border-border-subtle transition-colors data-[drop-target]:border-primary"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* The surface scrolls: a dashboard grows past the height of its column and the canvas
          is the thing that should scroll, not the page around it. `isolate` keeps the tiles'
          stacking to themselves, or a raised tile paints over the floating chrome beside it. */}
      <CanvasSurface
        ref={surfaceRef}
        className={`isolate overflow-auto data-[drop-target]:bg-primary/5 ${
          isGesturing ? 'select-none' : ''
        }`}
        data-drop-target={isDropTarget ? '' : undefined}
        style={DOTS}
      >
        {children}
      </CanvasSurface>
      {overlay}
    </Canvas>
  )
}
