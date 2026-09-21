/**
 * How the dashboard's three columns are split. Its own key rather than a field on `dashboard`,
 * because the split is a working preference about this screen and the tiles are the work: a user
 * who clears the canvas keeps the panel widths they set.
 */

import { z } from 'zod'

/** Panel ids; they key the layout the resizable group hands out and reads back. */
export const CATALOGUE_PANEL = 'catalogue'
export const CANVAS_PANEL = 'canvas'
export const ACTIVITY_PANEL = 'activity'

/** Percentages, matching what the group reports. */
export const DEFAULT_PANELS: PanelLayout = {
  [CATALOGUE_PANEL]: 22,
  [CANVAS_PANEL]: 56,
  [ACTIVITY_PANEL]: 22,
}

/** The shape react-resizable-panels stores a layout in: one number per panel id. */
export type PanelLayout = Readonly<Record<string, number>>

function readLayout(value: unknown): PanelLayout {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_PANELS

  const layout: Record<string, number> = {}
  for (const [id, size] of Object.entries(value as Record<string, unknown>)) {
    if (typeof size === 'number' && Number.isFinite(size) && size >= 0) layout[id] = size
  }

  // A layout missing a panel would leave that column unsized, which reads as a broken page.
  const complete = [CATALOGUE_PANEL, CANVAS_PANEL, ACTIVITY_PANEL].every(id => id in layout)
  return complete ? layout : DEFAULT_PANELS
}

/** Tolerant both ways, like every other stored shell key. */
export const PanelLayoutSchema: z.ZodType<PanelLayout> = z.unknown().transform(readLayout)

export function migratePanels(value: unknown): PanelLayout {
  return readLayout(value)
}
