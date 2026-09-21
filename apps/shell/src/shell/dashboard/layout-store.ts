/**
 * The dashboard belongs to none of the definitions on it, so it is the shell's own `dashboard`
 * key rather than a Widget's prefix, which would tie one Widget's storage to every other tile.
 *
 * A tile is a rectangle in canvas cells. It used to be one of four widths on a twelve-column
 * grid; a record written then still reads, because the width maps onto cells and the rest of the
 * placement is derived.
 */

import { z } from 'zod'

import { findFreeCell, MIN_COLUMNS, MIN_ROWS, settle, type Placed } from './grid.ts'

/** What a Widget gets when nothing says otherwise: wide enough to read, short enough to pair. */
export const DEFAULT_TILE = { w: 24, h: 14 } as const

/**
 * The canvas a tile is placed against when no one has measured one yet — the command palette can
 * add a Widget from any page. A tile placed past the real canvas's edge is scrolled to, not
 * squeezed, so guessing wide here costs a scrollbar rather than a layout.
 */
export const NOMINAL_COLUMNS = 48

/** The old four widths, as a fraction of the twelve columns they were spans of. */
const LEGACY_SPANS: Readonly<Record<number, number>> = { 4: 16, 6: 24, 8: 32, 12: 48 }

export interface DashboardTile extends Placed {
  /** Stable across re-renders and reorders; two tiles may share a widget id. */
  readonly key: string
  readonly widgetId: string
  /** Exactly what is handed to the Widget as props; validated at its boundary. */
  readonly inputs: Readonly<Record<string, unknown>>
}

export interface DashboardLayout {
  readonly tiles: readonly DashboardTile[]
}

export const EMPTY_LAYOUT: DashboardLayout = { tiles: [] }

/** `crypto.randomUUID` needs a secure context, which a plain-HTTP dev host is not. */
export function tileKey(widgetId: string): string {
  return `${widgetId}#${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function readCell(value: unknown, fallback: number, floor = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(floor, Math.round(value))
}

/**
 * Tolerant in both directions, and `index` is what lets a record from the twelve-column layout
 * come back stacked in the order it was saved rather than piled on the origin.
 */
function readTile(value: unknown, index: number): DashboardTile | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>

  const widgetId = candidate['widgetId']
  const key = candidate['key']
  const inputs = candidate['inputs']
  if (typeof widgetId !== 'string' || widgetId === '') return null
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) return null

  const legacy = LEGACY_SPANS[candidate['span'] as number]
  const w = readCell(candidate['w'], legacy ?? DEFAULT_TILE.w, MIN_COLUMNS)
  const h = readCell(candidate['h'], DEFAULT_TILE.h, MIN_ROWS)

  return {
    key: typeof key === 'string' && key !== '' ? key : tileKey(widgetId),
    widgetId,
    inputs: inputs as Record<string, unknown>,
    x: readCell(candidate['x'], 0),
    // Stacked rather than overlaid: a saved twelve-column dashboard had an order but no rows.
    y: readCell(candidate['y'], index * DEFAULT_TILE.h),
    w,
    h,
  }
}

function readTiles(values: readonly unknown[]): readonly DashboardTile[] {
  return settle(
    values
      .map((value, index) => readTile(value, index))
      .filter((tile): tile is DashboardTile => tile !== null),
  )
}

/** Tolerant both ways: every read and every write is checked against it. */
export const DashboardLayoutSchema: z.ZodType<DashboardLayout> = z.object({
  tiles: z.array(z.unknown()).transform(readTiles),
})

/** A record written before this key carried an envelope, read as tolerantly. */
export function migrateLayout(value: unknown): DashboardLayout {
  const tiles = (value as { tiles?: unknown } | null)?.tiles
  return { tiles: Array.isArray(tiles) ? readTiles(tiles) : [] }
}

/** What a caller knows about a new tile; where it goes is this module's business. */
export interface NewTile {
  readonly key: string
  readonly widgetId: string
  readonly inputs: Readonly<Record<string, unknown>>
  readonly w?: number
  readonly h?: number
}

/** Appends a tile in the first free place, wherever the caller is — the palette, or the canvas. */
export function addTile(
  layout: DashboardLayout,
  tile: NewTile,
  columns: number = NOMINAL_COLUMNS,
): DashboardLayout {
  const size = { w: tile.w ?? DEFAULT_TILE.w, h: tile.h ?? DEFAULT_TILE.h }
  const { x, y } = findFreeCell(layout.tiles, size, columns)

  return {
    tiles: [
      ...layout.tiles,
      { key: tile.key, widgetId: tile.widgetId, inputs: tile.inputs, x, y, ...size },
    ],
  }
}

/** Replaces one tile's rectangle, leaving everything else about it alone. */
export function placeTile(
  tiles: readonly DashboardTile[],
  key: string,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): readonly DashboardTile[] {
  return tiles.map(tile => (tile.key === key ? { ...tile, ...rect } : tile))
}
