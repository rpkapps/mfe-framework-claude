/**
 * Cell arithmetic for the canvas. Tiles are placed and sized in whole cells, so a drag lands
 * where the dots say it will and a saved dashboard means the same thing on a different screen.
 *
 * None of this touches the DOM: the pointer handling above it converts pixels to cells once and
 * everything after that is integers, which is what makes the placement rules testable.
 */

/** The dot pitch, in pixels. The canvas draws its grid at the same number, so they cannot drift. */
export const CELL = 24

/** Small enough for a readout, large enough that a mounted Widget is not a slot. */
export const MIN_COLUMNS = 6
export const MIN_ROWS = 5

/** A tile's place on the canvas, in cells from the top left. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface Placed extends Rect {
  readonly key: string
}

export function cellsFromPixels(pixels: number): number {
  return Math.round(pixels / CELL)
}

export function pixelsFromCells(cells: number): number {
  return cells * CELL
}

/** How many whole columns fit; the floor, because a partial column cannot hold a tile. */
export function columnsIn(width: number): number {
  return Math.max(MIN_COLUMNS, Math.floor(width / CELL))
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * A moved tile, snapped and kept on the canvas. The vertical axis has no ceiling — the canvas
 * scrolls — so only the left, right and top edges hold it.
 */
export function moveTo(rect: Rect, x: number, y: number, columns: number): Rect {
  return {
    ...rect,
    x: clamp(Math.round(x), 0, Math.max(0, columns - rect.w)),
    y: Math.max(0, Math.round(y)),
  }
}

/** Which edge or corner a resize is pulling. */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * A resized tile. Dragging a leading edge moves the origin as well as the size, and the minimum
 * is enforced against that edge, so pulling the left edge right past the minimum pins the left
 * edge rather than letting the tile walk across the canvas.
 */
export function resizeBy(
  rect: Rect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  columns: number,
): Rect {
  let { x, y, w, h } = rect

  if (edge.includes('e')) w = clamp(rect.w + dx, MIN_COLUMNS, columns - rect.x)
  if (edge.includes('w')) {
    const right = rect.x + rect.w
    x = clamp(rect.x + dx, 0, right - MIN_COLUMNS)
    w = right - x
  }
  if (edge.includes('s')) h = Math.max(MIN_ROWS, rect.h + dy)
  if (edge.includes('n')) {
    const bottom = rect.y + rect.h
    y = clamp(rect.y + dy, 0, bottom - MIN_ROWS)
    h = bottom - y
  }

  return { x, y, w, h }
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Pushes whatever `moved` now covers downwards, and whatever those tiles cover in turn. Tiles
 * settle below rather than swapping, because a swap moves a tile the user was not touching to a
 * place they did not choose.
 */
export function resolveCollisions<T extends Placed>(
  tiles: readonly T[],
  movedKey: string,
): readonly T[] {
  const byKey = new Map(tiles.map(tile => [tile.key, tile] as const))
  const settled = new Set<string>([movedKey])
  const queue: string[] = [movedKey]

  while (queue.length > 0) {
    const key = queue.shift()
    if (key === undefined) continue
    const source = byKey.get(key)
    if (source === undefined) continue

    // Top to bottom, so a tile pushed down is compared against the already-pushed one above it.
    const below = [...byKey.values()]
      .filter(tile => tile.key !== key && overlaps(source, tile))
      .sort((left, right) => left.y - right.y)

    for (const tile of below) {
      byKey.set(tile.key, { ...tile, y: source.y + source.h })
      if (!settled.has(tile.key)) settled.add(tile.key)
      queue.push(tile.key)
    }
  }

  return tiles.map(tile => byKey.get(tile.key) ?? tile)
}

/**
 * The first place a new tile fits, scanning left to right and top to bottom. A tile dropped onto
 * a full canvas lands under everything rather than on top of something.
 */
export function findFreeCell(
  tiles: readonly Placed[],
  size: { readonly w: number; readonly h: number },
  columns: number,
): { readonly x: number; readonly y: number } {
  const w = Math.min(size.w, columns)
  const bottom = tiles.reduce((lowest, tile) => Math.max(lowest, tile.y + tile.h), 0)

  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + w <= columns; x += 1) {
      const candidate = { x, y, w, h: size.h }
      if (!tiles.some(tile => overlaps(candidate, tile))) return { x, y }
    }
  }

  return { x: 0, y: bottom }
}

/**
 * Settles every tile below whatever it already overlaps, in the order given. Nothing on a canvas
 * should sit on top of anything else, and a record can arrive overlapping — from an older layout,
 * or from a canvas that was a different width when it was written.
 */
export function settle<T extends Placed>(tiles: readonly T[]): readonly T[] {
  const placed: T[] = []

  for (const tile of tiles) {
    let candidate = tile
    for (;;) {
      const hit = placed.find(other => overlaps(candidate, other))
      if (hit === undefined) break
      candidate = { ...candidate, y: hit.y + hit.h }
    }
    placed.push(candidate)
  }

  return placed
}

/**
 * How wide the surface is: the visible canvas, or the rightmost tile when one reaches past it.
 * The canvas scrolls rather than squeezing — narrowing a tile to fit the window would rewrite a
 * layout the user built on a wider one, and pushing it left would slide it under its neighbour.
 */
export function canvasColumns(tiles: readonly Placed[], visibleColumns: number): number {
  return tiles.reduce((widest, tile) => Math.max(widest, tile.x + tile.w), visibleColumns)
}

/** The canvas is as tall as its lowest tile plus room to drop another one under it. */
export function canvasRows(tiles: readonly Placed[]): number {
  return tiles.reduce((lowest, tile) => Math.max(lowest, tile.y + tile.h), 0) + MIN_ROWS
}
