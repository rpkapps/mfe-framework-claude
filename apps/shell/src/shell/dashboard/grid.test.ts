/** The placement rules, away from the pointer handling that feeds them. */

import { describe, expect, it } from 'vitest'

import {
  canvasColumns,
  canvasRows,
  columnsIn,
  findFreeCell,
  MIN_COLUMNS,
  MIN_ROWS,
  moveTo,
  overlaps,
  resizeBy,
  resolveCollisions,
  settle,
  type Placed,
} from './grid.ts'

const COLUMNS = 40

function tile(key: string, x: number, y: number, w = 10, h = 8): Placed {
  return { key, x, y, w, h }
}

describe('moveTo', () => {
  it('snaps to whole cells', () => {
    expect(moveTo({ x: 0, y: 0, w: 10, h: 8 }, 3.4, 6.6, COLUMNS)).toMatchObject({ x: 3, y: 7 })
  })

  it('keeps the whole tile on the canvas rather than its origin', () => {
    const rect = moveTo({ x: 0, y: 0, w: 10, h: 8 }, 38, 0, COLUMNS)
    expect(rect.x + rect.w).toBe(COLUMNS)
  })

  it('has no floor below the top, because the canvas scrolls down', () => {
    expect(moveTo({ x: 0, y: 4, w: 10, h: 8 }, 0, -3, COLUMNS).y).toBe(0)
    expect(moveTo({ x: 0, y: 4, w: 10, h: 8 }, 0, 400, COLUMNS).y).toBe(400)
  })
})

describe('resizeBy', () => {
  it('grows from a trailing edge without moving the origin', () => {
    expect(resizeBy({ x: 4, y: 2, w: 10, h: 8 }, 'se', 3, 2, COLUMNS)).toEqual({
      x: 4,
      y: 2,
      w: 13,
      h: 10,
    })
  })

  it('moves the origin when a leading edge is pulled', () => {
    expect(resizeBy({ x: 10, y: 6, w: 12, h: 9 }, 'nw', -2, -3, COLUMNS)).toEqual({
      x: 8,
      y: 3,
      w: 14,
      h: 12,
    })
  })

  it('pins the leading edge at the minimum instead of walking the tile across', () => {
    const rect = resizeBy({ x: 2, y: 0, w: MIN_COLUMNS, h: MIN_ROWS }, 'w', 50, 0, COLUMNS)
    expect(rect.w).toBe(MIN_COLUMNS)
    expect(rect.x + rect.w).toBe(2 + MIN_COLUMNS)
  })

  it('never grows a tile past the right edge', () => {
    const rect = resizeBy({ x: 30, y: 0, w: 10, h: 8 }, 'e', 40, 0, COLUMNS)
    expect(rect.x + rect.w).toBe(COLUMNS)
  })

  it('holds the minimum on both axes', () => {
    const rect = resizeBy({ x: 0, y: 0, w: 10, h: 8 }, 'se', -50, -50, COLUMNS)
    expect(rect).toMatchObject({ w: MIN_COLUMNS, h: MIN_ROWS })
  })
})

describe('resolveCollisions', () => {
  it('leaves tiles that do not touch alone', () => {
    const tiles = [tile('a', 0, 0), tile('b', 20, 0)]
    expect(resolveCollisions(tiles, 'a')).toEqual(tiles)
  })

  it('pushes what the moved tile now covers downwards', () => {
    const tiles = [tile('a', 0, 0, 10, 8), tile('b', 0, 2, 10, 8)]
    const [, b] = resolveCollisions(tiles, 'a')
    expect(b?.y).toBe(8)
  })

  it('carries the push down a chain rather than stopping at the first tile', () => {
    const tiles = [tile('a', 0, 0, 10, 8), tile('b', 0, 2, 10, 8), tile('c', 0, 4, 10, 8)]
    const resolved = resolveCollisions(tiles, 'a')
    expect(resolved.map(entry => entry.y)).toEqual([0, 8, 16])
  })

  it('never moves the tile the user is holding', () => {
    const tiles = [tile('a', 0, 10, 10, 8), tile('b', 0, 8, 10, 8)]
    const [a] = resolveCollisions(tiles, 'a')
    expect(a).toMatchObject({ x: 0, y: 10 })
  })
})

describe('findFreeCell', () => {
  it('fills the gap beside a tile before going below it', () => {
    const tiles = [tile('a', 0, 0, 10, 8)]
    expect(findFreeCell(tiles, { w: 10, h: 8 }, COLUMNS)).toEqual({ x: 10, y: 0 })
  })

  it('goes under everything when no row has room', () => {
    const tiles = [tile('a', 0, 0, COLUMNS, 8)]
    expect(findFreeCell(tiles, { w: 10, h: 8 }, COLUMNS)).toEqual({ x: 0, y: 8 })
  })

  it('narrows a tile too wide for the canvas rather than refusing it', () => {
    expect(findFreeCell([], { w: 100, h: 8 }, COLUMNS)).toEqual({ x: 0, y: 0 })
  })
})

describe('the canvas itself', () => {
  it('is measured in whole columns, never fewer than the minimum', () => {
    expect(columnsIn(24 * 40)).toBe(40)
    expect(columnsIn(23)).toBe(MIN_COLUMNS)
  })

  it('keeps room under the lowest tile to drop another one', () => {
    expect(canvasRows([tile('a', 0, 4, 10, 8)])).toBe(12 + MIN_ROWS)
    expect(canvasRows([])).toBe(MIN_ROWS)
  })

  it('is as wide as the window until a tile reaches past it', () => {
    expect(canvasColumns([tile('a', 0, 0, 10, 8)], COLUMNS)).toBe(COLUMNS)
  })

  it('grows to the rightmost tile rather than squeezing it back in', () => {
    expect(canvasColumns([tile('a', 36, 0, 20, 8)], COLUMNS)).toBe(56)
  })

  it('counts a shared edge as clear, not as an overlap', () => {
    expect(overlaps({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 0, w: 4, h: 4 })).toBe(false)
    expect(overlaps({ x: 0, y: 0, w: 4, h: 4 }, { x: 3, y: 0, w: 4, h: 4 })).toBe(true)
  })
})

describe('settle', () => {
  it('leaves a layout that already clears itself untouched', () => {
    const tiles = [tile('a', 0, 0), tile('b', 20, 0)]
    expect(settle(tiles)).toEqual(tiles)
  })

  it('drops a tile below the one it was written on top of', () => {
    const settled = settle([tile('a', 0, 0, 10, 8), tile('b', 5, 4, 10, 8)])
    expect(settled[1]).toMatchObject({ x: 5, y: 8 })
  })

  it('keeps pushing until the tile clears everything above it', () => {
    const settled = settle([tile('a', 0, 0, 10, 8), tile('b', 0, 8, 10, 8), tile('c', 0, 0, 10, 8)])
    expect(settled[2]?.y).toBe(16)
  })
})
