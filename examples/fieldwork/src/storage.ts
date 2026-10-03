/**
 * Every value Fieldwork reads or stores, declared once. The Lab's keys are read with
 * `storedKey.from`: Fieldwork brings its own schema and defaults, never imports the Lab's, and
 * cannot write them.
 */

import { storedKey } from '@company/mfe-angular'
import { z } from 'zod'

/** The Lab's depth units. */
export const labUnits = storedKey.from(
  'lab',
  'units',
  z.enum(['metric', 'imperial']).default('metric'),
  { storage: 'user' },
)

/** The Lab's selected well and survey, with only the fields Fieldwork reads. */
export const labSelection = storedKey.from(
  'lab',
  'well-selection',
  z
    .object({
      wellId: z.string(),
      runId: z.string().nullable(),
      comparisonMode: z.enum(['baseline', 'overlay']).default('baseline'),
    })
    .nullable()
    .default(null),
  { storage: 'user' },
)

/** The inspection brief the well-inspection Widget prepares; the Widget owns and saves it. */
export const inspectionBrief = storedKey(
  'brief',
  z.object({ wellId: z.string(), runId: z.string(), text: z.string() }).nullable().default(null),
  { storage: 'user' },
)
