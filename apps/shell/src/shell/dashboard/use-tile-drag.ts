/**
 * Turns pointer drags into cell rectangles. The arithmetic lives in `grid.ts`; this is only the
 * part that has to know about pixels, pointer capture and when a gesture is finished.
 *
 * A gesture is previewed in component state and committed to storage once, on release, so
 * dragging a tile does not write to storage on every pointer move.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { cellsFromPixels, moveTo, resizeBy, type Rect, type ResizeEdge } from './grid.ts'

/** A move has no edge; a resize names the one being pulled. */
export interface Gesture {
  readonly key: string
  readonly edge: ResizeEdge | null
  readonly rect: Rect
}

export interface TileDrag {
  /** The gesture in flight, so the canvas can draw the tile where it is going. */
  readonly gesture: Gesture | null
  readonly startMove: (event: React.PointerEvent, key: string, rect: Rect) => void
  readonly startResize: (
    event: React.PointerEvent,
    key: string,
    rect: Rect,
    edge: ResizeEdge,
  ) => void
}

/** Where the gesture began, so every move is measured from one point rather than the last event. */
interface Origin {
  readonly key: string
  readonly edge: ResizeEdge | null
  readonly rect: Rect
  readonly pointerX: number
  readonly pointerY: number
  readonly pointerId: number
  readonly target: Element
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

export function useTileDrag(
  columns: number,
  onCommit: (key: string, rect: Rect) => void,
): TileDrag {
  const [gesture, setGesture] = useState<Gesture | null>(null)
  // Written only from event handlers, which is the one place a ref may be touched.
  const origin = useRef<Origin | null>(null)
  // Read on release, where the last event may carry no movement of its own.
  const latest = useRef<Gesture | null>(null)

  const begin = useCallback(
    (event: React.PointerEvent, key: string, rect: Rect, edge: ResizeEdge | null) => {
      // Secondary buttons open menus; only a primary press starts a gesture.
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      origin.current = {
        key,
        edge,
        rect,
        pointerX: event.clientX,
        pointerY: event.clientY,
        pointerId: event.pointerId,
        target: event.currentTarget,
      }
      // Captured, so the gesture survives the pointer leaving the tile it started on.
      event.currentTarget.setPointerCapture(event.pointerId)
      latest.current = { key, edge, rect }
      setGesture({ key, edge, rect })
    },
    [],
  )

  const isDragging = gesture !== null

  useEffect(() => {
    if (!isDragging) return

    const move = (event: PointerEvent): void => {
      const from = origin.current
      if (from === null || event.pointerId !== from.pointerId) return

      const dx = cellsFromPixels(event.clientX - from.pointerX)
      const dy = cellsFromPixels(event.clientY - from.pointerY)
      const rect =
        from.edge === null
          ? moveTo(from.rect, from.rect.x + dx, from.rect.y + dy, columns)
          : resizeBy(from.rect, from.edge, dx, dy, columns)

      const next = { key: from.key, edge: from.edge, rect }
      latest.current = next
      // Only when the cell actually changed: a pointer move within one cell is not a new layout.
      setGesture(current => (current !== null && sameRect(current.rect, rect) ? current : next))
    }

    const finish = (event: PointerEvent): void => {
      const from = origin.current
      if (from === null || event.pointerId !== from.pointerId) return

      const settled = latest.current
      origin.current = null
      latest.current = null
      setGesture(null)
      if (from.target.hasPointerCapture(event.pointerId)) {
        from.target.releasePointerCapture(event.pointerId)
      }
      if (settled !== null) onCommit(settled.key, settled.rect)
    }

    const cancel = (): void => {
      origin.current = null
      latest.current = null
      setGesture(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
    }
    // Re-subscribing when the canvas is resized mid-drag is harmless: the origin outlives it.
  }, [isDragging, columns, onCommit])

  return {
    gesture,
    startMove: useCallback(
      (event: React.PointerEvent, key: string, rect: Rect) => {
        begin(event, key, rect, null)
      },
      [begin],
    ),
    startResize: useCallback(
      (event: React.PointerEvent, key: string, rect: Rect, edge: ResizeEdge) => {
        begin(event, key, rect, edge)
      },
      [begin],
    ),
  }
}

/**
 * The keyboard equivalent of the two gestures. A tile that can only be placed with a pointer is
 * a tile some people cannot place at all, and the rest of this shell is React Aria.
 */
export function tileKeyboardMove(
  key: string,
  rect: Rect,
  event: React.KeyboardEvent,
  columns: number,
  onCommit: (key: string, rect: Rect) => void,
): boolean {
  const step = event.altKey ? 1 : 2
  const delta =
    event.key === 'ArrowLeft'
      ? [-step, 0]
      : event.key === 'ArrowRight'
        ? [step, 0]
        : event.key === 'ArrowUp'
          ? [0, -step]
          : event.key === 'ArrowDown'
            ? [0, step]
            : null
  if (delta === null) return false

  const [dx = 0, dy = 0] = delta
  event.preventDefault()

  // Shift resizes from the trailing edges, which is the gesture with no origin to move.
  onCommit(
    key,
    event.shiftKey
      ? resizeBy(rect, dx !== 0 ? 'e' : 's', dx, dy, columns)
      : moveTo(rect, rect.x + dx, rect.y + dy, columns),
  )
  return true
}
