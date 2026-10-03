/**
 * Every value the shell stores, declared once. Outside any mount they belong to the host page
 * (`@host`), so no App can read or write them as its own.
 */

import { storedKey } from '@company/mfe-react'
import { z } from 'zod'

import {
  DashboardLayoutSchema,
  EMPTY_LAYOUT,
  migrateLayout,
} from './shell/dashboard/layout-store.ts'
import {
  DEFAULT_PANELS,
  migratePanels,
  PanelLayoutSchema,
  SNAP_TO_TOP_DEFAULT,
  SnapToTopSchema,
} from './shell/dashboard/panels-store.ts'

/**
 * The user's theme preference, saved with their other user values and passed to
 * `createMfeRuntime({ theme })`, which applies it to the document and caches it for first paint.
 */
export const themeKey = storedKey('theme', z.enum(['light', 'dark', 'system']).default('system'), {
  storage: 'user',
})

/** One key for every reader, so a Widget added from the palette is already on the canvas. */
export const dashboardKey = storedKey('dashboard', DashboardLayoutSchema.default(EMPTY_LAYOUT), {
  migrate: migrateLayout,
})

/** The split between catalogue, canvas and activity, remembered across reloads like the tiles. */
export const dashboardPanelsKey = storedKey(
  'dashboard-panels',
  PanelLayoutSchema.default(DEFAULT_PANELS),
  { migrate: migratePanels },
)

/** Whether the canvas lifts its tiles to the top when a drag is released. */
export const snapToTopKey = storedKey(
  'dashboard-snap',
  SnapToTopSchema.default(SNAP_TO_TOP_DEFAULT),
)

/** The width, in pixels, the user last dragged the assistant to; null until they do. */
export const assistantWidthKey = storedKey(
  'assistant-width',
  z.number().positive().nullable().default(null),
)
