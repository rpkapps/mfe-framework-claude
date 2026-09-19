/**
 * The dashboard the developer built, and where it is kept.
 *
 * A dashboard assembled by dragging widgets around is worthless if a reload
 * throws it away, so it is persisted. It is persisted in the *shell's* own
 * storage rather than through `runtime.storage`, because the framework's
 * storage is scoped to a definition — `<id>:<key>`, retired when the session
 * changes — and this layout belongs to none of the definitions on it. Writing
 * it under a Widget's prefix would tie one Widget's storage to the presence of
 * every other tile.
 *
 * Nothing here is a component, so it is also the module React Refresh can
 * replace without touching the tiles that read it.
 */

const STORAGE_KEY = 'company:shell:dashboard'

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

function isSpan(value: unknown): value is TileSpan {
  return TILE_SPANS.some(span => span === value)
}

/**
 * A stored layout is untrusted input: it was written by an older build, or
 * edited by hand in devtools. Anything unreadable is dropped tile by tile
 * rather than failing the page — the same per-entry rule the registry uses.
 */
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
    span: isSpan(candidate['span']) ? candidate['span'] : 6,
  }
}

function readStored(storage: Pick<Storage, 'getItem'> | undefined): DashboardLayout {
  if (storage === undefined) return EMPTY_LAYOUT

  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return EMPTY_LAYOUT
    const parsed: unknown = JSON.parse(raw)
    const tiles = (parsed as { tiles?: unknown }).tiles
    if (!Array.isArray(tiles)) return EMPTY_LAYOUT
    return { tiles: tiles.map(readTile).filter((tile): tile is DashboardTile => tile !== null) }
  } catch {
    return EMPTY_LAYOUT
  }
}

/** Storage can be blocked for the origin, and writing then throws rather than no-ops. */
function writeStored(storage: Pick<Storage, 'setItem'> | undefined, layout: DashboardLayout): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // A dashboard that cannot be saved is still a dashboard that works.
  }
}

/** Reading `localStorage` throws outright when storage is blocked for the origin. */
export function dashboardStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/*
 * The layout is a store rather than a component's state because the dashboard
 * page is not the only thing that changes it: the command palette adds a Widget
 * and settings resets the canvas, from outside the page and sometimes while it
 * is not even mounted. A second copy in component state would show a stale
 * canvas until the next navigation.
 */

let current: DashboardLayout | null = null
const listeners = new Set<() => void>()

/** Read once, then kept: `useSyncExternalStore` needs a stable reference. */
export function getLayout(): DashboardLayout {
  current ??= readStored(dashboardStorage())
  return current
}

export function subscribeLayout(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setLayout(next: DashboardLayout): void {
  current = next
  writeStored(dashboardStorage(), next)
  for (const listener of listeners) listener()
}

export function setTiles(tiles: readonly DashboardTile[]): void {
  setLayout({ tiles })
}

/** Appends a tile, wherever the caller is — the palette, or the canvas itself. */
export function addTile(tile: DashboardTile): void {
  setTiles([...getLayout().tiles, tile])
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
