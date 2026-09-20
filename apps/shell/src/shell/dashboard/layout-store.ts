/**
 * The dashboard the developer built: its shape, and the pure moves over it.
 *
 * It belongs to none of the definitions on it — writing it under a Widget's
 * prefix would tie one Widget's storage to the presence of every other tile —
 * so it is the shell's own `dashboard` key, kept across a sign-out. A stored
 * layout is untrusted input, written by an older build or edited by hand, so
 * anything unreadable is dropped tile by tile rather than failing the page.
 */

import { z } from 'zod'

/** How wide a tile sits on the twelve-column canvas. */
export const TILE_SPANS = [4, 6, 8, 12] as const
export type TileSpan = (typeof TILE_SPANS)[number]

export interface DashboardTile {
  /** Stable across re-renders and reorders; two tiles may share a widget id. */
  readonly key: string
  readonly widgetId: string
  /** Exactly what is handed to the Widget as props. Validated at its boundary. */
  readonly inputs: Readonly<Record<string, unknown>>
  readonly span: TileSpan
}

export interface DashboardLayout {
  readonly tiles: readonly DashboardTile[]
}

export const EMPTY_LAYOUT: DashboardLayout = { tiles: [] }

/** `crypto.randomUUID` needs a secure context, which a plain-HTTP dev host is not. */
export function tileKey(widgetId: string): string {
  return `${widgetId}#${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function readTile(value: unknown): DashboardTile | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>

  const widgetId = candidate['widgetId']
  const key = candidate['key']
  const inputs = candidate['inputs']
  if (typeof widgetId !== 'string' || widgetId === '') return null
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) return null

  return {
    key: typeof key === 'string' && key !== '' ? key : tileKey(widgetId),
    widgetId,
    inputs: inputs as Record<string, unknown>,
    span: TILE_SPANS.find(span => span === candidate['span']) ?? 6,
  }
}

function readTiles(values: readonly unknown[]): DashboardTile[] {
  return values.map(readTile).filter((tile): tile is DashboardTile => tile !== null)
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

/** Appends a tile, wherever the caller is — the palette, or the canvas itself. */
export function addTile(layout: DashboardLayout, tile: DashboardTile): DashboardLayout {
  return { tiles: [...layout.tiles, tile] }
}

export function moveTile(
  tiles: readonly DashboardTile[],
  fromKey: string,
  toKey: string,
): readonly DashboardTile[] {
  const from = tiles.findIndex(tile => tile.key === fromKey)
  const to = tiles.findIndex(tile => tile.key === toKey)
  if (from === -1 || to === -1 || from === to) return tiles

  const next = [...tiles]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return tiles
  next.splice(to, 0, moved)
  return next
}
