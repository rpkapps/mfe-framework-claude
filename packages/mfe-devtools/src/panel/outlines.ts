/**
 * Where every mounted App and Widget is on the page, measured from the DOM rather than asked of
 * the runtime: a mount the shell has forgotten about still draws a box, which is the question
 * "what is this region" being asked of a page nobody can read the source of.
 *
 * The framework stamps the contract this reads — `data-mfe-scope`, `data-mfe-mount`,
 * `data-mfe-kind` — so the attribute names come from `@company/mfe-react` rather than being
 * retyped here (§17).
 */

import { useEffect, useState } from 'react'
import {
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
} from '@company/mfe-react'

/**
 * Mount roots, less the body-level overlay roots: those carry the same scope and mount token but
 * hold a portalled popover, so a box round one would be labelled with a definition it is not.
 */
export const MOUNT_SELECTOR = `[${SCOPE_ATTRIBUTE}][${MOUNT_ATTRIBUTE}]:not([${OVERLAY_ROOT_ATTRIBUTE}])`

/** A scope root is `display: contents`; six levels is well past the wrappers a mount puts in front of its content. */
const MAX_DEPTH = 6

/** Viewport coordinates, in CSS pixels. */
export interface OutlineRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface MountOutline {
  /** The mount token, which is unique per mount rather than per definition. */
  readonly key: string
  readonly id: string
  readonly kind: 'app' | 'widget' | 'unknown'
  /** How many mounts this one is inside, so a Widget in an App can be drawn as the inner thing. */
  readonly depth: number
  readonly rect: OutlineRect
}

/** The smallest rectangle covering them all, or nothing when there is nothing to cover. */
export function unionOf(rects: readonly OutlineRect[]): OutlineRect | undefined {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const rect of rects) {
    // A box with no area contributes no edges: an empty wrapper would otherwise drag the union to it.
    if (rect.width <= 0 || rect.height <= 0) continue
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }

  if (left === Infinity) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** What is left of `a` inside `b`, or nothing when they do not meet. */
export function intersectionOf(a: OutlineRect, b: OutlineRect): OutlineRect | undefined {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)

  if (right <= left || bottom <= top) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * What a mount occupies. The scope root generates no box of its own, so this is the union of the
 * boxes it renders — descending only through the elements that have none, which is both the
 * `display: contents` wrappers and the empty ones.
 *
 * The union is then cut down to what each scrolling ancestor still shows, so a tile half scrolled
 * out of the dashboard canvas is outlined where it is rather than across the panel beside it. The
 * containing block of an absolutely positioned mount is not worked out — an `overflow` ancestor
 * that does not in fact clip it would cut the box short — because the alternative is reimplementing
 * layout, and every mount this draws for is in the flow of the region it was placed in.
 */
export function measureMount(element: Element): OutlineRect | undefined {
  const boxes: OutlineRect[] = []
  collectBoxes(element, 0, boxes)

  let rect = unionOf(boxes)
  let current: Element | null = element

  while (rect !== undefined && current !== null) {
    // A fixed element is laid out against the viewport, so no ancestor's overflow reaches it.
    if (getComputedStyle(current).position === 'fixed') break

    const parent: Element | null = current.parentElement
    if (parent === null) break
    if (clipsItsContent(parent)) rect = intersectionOf(rect, parent.getBoundingClientRect())
    current = parent
  }

  return rect
}

function clipsItsContent(element: Element): boolean {
  const { overflow, overflowX, overflowY } = getComputedStyle(element)
  // All three, because the shorthand and the two axes are not all reported by every engine.
  return [overflow, overflowX, overflowY].some(value => value !== '' && value !== 'visible')
}

function collectBoxes(element: Element, depth: number, into: OutlineRect[]): void {
  const rect = element.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    into.push(rect)
    return
  }

  if (depth >= MAX_DEPTH) return
  // Indexed rather than iterated: `HTMLCollection` is not declared iterable, whatever a browser allows.
  const children = element.children
  for (let index = 0; index < children.length; index += 1) {
    const child = children.item(index)
    if (child !== null) collectBoxes(child, depth + 1, into)
  }
}

function kindOf(element: Element): MountOutline['kind'] {
  const kind = element.getAttribute(KIND_ATTRIBUTE)
  return kind === 'app' || kind === 'widget' ? kind : 'unknown'
}

/** How many mounts enclose this one. A Widget mounted by an App is one deep. */
function depthOf(element: Element): number {
  let depth = 0
  let ancestor = element.parentElement?.closest(MOUNT_SELECTOR) ?? null
  while (ancestor !== null) {
    depth += 1
    ancestor = ancestor.parentElement?.closest(MOUNT_SELECTOR) ?? null
  }
  return depth
}

/** Rounded to whole pixels: a fractional box draws a blurred border, and the difference is not information. */
function round(rect: OutlineRect): OutlineRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

/** Every mount in `root` that occupies space. One that renders nothing is left undrawn rather than drawn empty. */
export function readMountOutlines(root: ParentNode): readonly MountOutline[] {
  const outlines: MountOutline[] = []

  for (const element of root.querySelectorAll(MOUNT_SELECTOR)) {
    const rect = measureMount(element)
    if (rect === undefined) continue

    outlines.push({
      key: element.getAttribute(MOUNT_ATTRIBUTE) ?? '',
      id: element.getAttribute(SCOPE_ATTRIBUTE) ?? '',
      kind: kindOf(element),
      depth: depthOf(element),
      rect: round(rect),
    })
  }

  // Outermost first, so a Widget's box paints over the App's tint rather than under it.
  return outlines.sort((a, b) => a.depth - b.depth)
}

/** Cheap enough to compare every frame, and the only thing that decides whether React hears about a pass. */
function signatureOf(outlines: readonly MountOutline[]): string {
  return outlines
    .map(({ key, id, rect }) => `${key}:${id}:${rect.x},${rect.y},${rect.width},${rect.height}`)
    .join('|')
}

/**
 * Re-measured on every frame while the overlay is mounted. Nothing reports a mount moving — a tile
 * dragged across the dashboard changes an ancestor's inline style, a scroll moves everything, and
 * a Widget resizes itself — so the honest options are measuring per frame or being wrong; a pass
 * that finds nothing changed re-renders nothing, so the cost is the measuring.
 */
export function useMountOutlines(): readonly MountOutline[] {
  const [outlines, setOutlines] = useState<readonly MountOutline[]>([])

  useEffect(() => {
    let frame = 0
    let previous = ''

    const measure = (): void => {
      const next = readMountOutlines(document)
      const signature = signatureOf(next)
      if (signature !== previous) {
        previous = signature
        setOutlines(next)
      }
      frame = requestAnimationFrame(measure)
    }

    frame = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [])

  return outlines
}
