/**
 * Whether the devtools are on, and how the panel was left.
 *
 * One key, read once: the panel ships in production and is gated at runtime, so
 * the cost a page that never opts in pays is this file and nothing else. The
 * flag deliberately does not go through mount-scoped storage — it belongs to
 * the page's own bootstrap rather than to any definition, which is the same
 * reason the override key does not.
 *
 * Reading `localStorage` throws outright when storage is blocked for an origin,
 * so every access here is wrapped and a failure means "off". A developer tool
 * that took the page down because a browser refused a cookie jar would be the
 * worse bug.
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

/**
 * The stored value. A bare `"1"` is accepted as well as the object the panel
 * writes, so turning this on by hand stays a one-liner in a console rather than
 * a JSON document somebody has to get right.
 */
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
    // Not JSON and not a flag word. Nothing here is worth failing over: the
    // repair is to turn it on again, which overwrites this.
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

/**
 * The query parameter, if this page carries one. `?devtools` with no value
 * counts as on, which is what somebody typing it into the address bar means.
 */
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
 * The settings for this page load.
 *
 * The query parameter wins and is persisted, so the next reload keeps the
 * answer without the parameter — the point of the link is to turn the tool on,
 * not to have to keep it in the URL. `?devtools=0` is the same in reverse: it
 * turns the tool off and clears the key, so a forgotten flag has an off switch
 * that does not require a console.
 *
 * The URL is left alone. The boundary navigator owns history here, and a spent
 * parameter is harmless once the answer is stored.
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
    // Off is the absence of the key, so clearing leaves nothing behind to read
    // back a stale side or size from.
    else area.removeItem(DEVTOOLS_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
