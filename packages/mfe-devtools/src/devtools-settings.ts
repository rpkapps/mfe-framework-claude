/**
 * Whether the devtools are on, and how the panel was left: one key, read once, because the panel
 * ships in production and is gated at runtime (§22). The flag is not mount-scoped storage, since
 * it belongs to the page's own bootstrap rather than to any definition (§24).
 */

import { browserStorage } from './browser-storage.ts'

/** The documented localStorage key. */
export const DEVTOOLS_STORAGE_KEY = 'company:mfe:devtools'

/** The query parameter, for turning the panel on from a link. */
export const DEVTOOLS_QUERY_PARAM = 'devtools'

/** Which edge the panel is docked to. */
export type DevtoolsSide = 'top' | 'bottom' | 'left' | 'right'

/** Which tab is showing. */
export type DevtoolsTab = 'overrides' | 'registry'

export interface DevtoolsSettings {
  /** Whether the trigger renders and the panel chunk is fetched at all. */
  readonly on: boolean
  readonly side: DevtoolsSide
  /** Height when docked top or bottom, width when docked left or right, in px. */
  readonly size: number
  readonly open: boolean
  readonly tab: DevtoolsTab
}

export const DEFAULT_SETTINGS: DevtoolsSettings = Object.freeze({
  on: false,
  side: 'bottom',
  size: 420,
  open: true,
  tab: 'overrides',
})

const SIDES: readonly DevtoolsSide[] = ['top', 'bottom', 'left', 'right']
const TABS: readonly DevtoolsTab[] = ['overrides', 'registry']

/** The truthy spellings a developer types into a console or a URL. */
const TRUTHY = new Set(['1', 'true', 'on', 'yes', ''])
const FALSY = new Set(['0', 'false', 'off', 'no'])

function isSide(value: unknown): value is DevtoolsSide {
  return SIDES.includes(value as DevtoolsSide)
}

function isTab(value: unknown): value is DevtoolsTab {
  return TABS.includes(value as DevtoolsTab)
}

/** A bare `"1"` is accepted as well as the object the panel writes, so turning this on by hand stays a one-liner. */
function readStored(): DevtoolsSettings {
  let raw: string | null
  try {
    raw = browserStorage()?.getItem(DEVTOOLS_STORAGE_KEY) ?? null
  } catch {
    return DEFAULT_SETTINGS
  }

  if (raw === null) return DEFAULT_SETTINGS
  if (TRUTHY.has(raw)) return { ...DEFAULT_SETTINGS, on: true }
  if (FALSY.has(raw)) return DEFAULT_SETTINGS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Nothing here is worth failing over: the repair is to turn it on again, which overwrites this.
    return DEFAULT_SETTINGS
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return DEFAULT_SETTINGS
  }

  const record = parsed as Record<string, unknown>
  return {
    on: record['on'] === true,
    side: isSide(record['side']) ? record['side'] : DEFAULT_SETTINGS.side,
    size:
      typeof record['size'] === 'number' && Number.isFinite(record['size'])
        ? record['size']
        : DEFAULT_SETTINGS.size,
    open: record['open'] !== false,
    tab: isTab(record['tab']) ? record['tab'] : DEFAULT_SETTINGS.tab,
  }
}

/** `?devtools` with no value counts as on, which is what somebody typing it into the address bar means. */
function readQueryParam(): boolean | undefined {
  let search: string
  try {
    search = window.location.search
  } catch {
    return undefined
  }

  const value = new URLSearchParams(search).get(DEVTOOLS_QUERY_PARAM)
  if (value === null) return undefined
  const normalized = value.toLowerCase()
  if (TRUTHY.has(normalized)) return true
  if (FALSY.has(normalized)) return false
  return undefined
}

/**
 * The settings for this page load: the query parameter wins and is persisted, so the next reload
 * keeps the answer without it, and `?devtools=0` is the off switch that needs no console.
 */
export function readDevtoolsSettings(): DevtoolsSettings {
  const stored = readStored()
  const fromQuery = readQueryParam()
  if (fromQuery === undefined) return stored

  const next: DevtoolsSettings = fromQuery
    ? { ...stored, on: true }
    : { ...DEFAULT_SETTINGS, on: false }
  writeDevtoolsSettings(next)
  return next
}

/** Persists the whole record. Returns false when the browser refuses storage. */
export function writeDevtoolsSettings(settings: DevtoolsSettings): boolean {
  const area = browserStorage()
  if (!area) return false

  try {
    if (settings.on) area.setItem(DEVTOOLS_STORAGE_KEY, JSON.stringify(settings))
    // Off is the absence of the key, so nothing stale is left behind to read a side or size back from.
    else area.removeItem(DEVTOOLS_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
