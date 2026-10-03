/**
 * Every value the Lab stores, declared once. The Lab owns each of them; another app reads one
 * with `storedKey.from('lab', ...)` and its own schema, and cannot write it.
 */

import { storedKey } from '@company/mfe-react'
import { z } from 'zod'

/** A draft note: browser storage, so the next person on this browser reads it too (§56). */
export const draft = storedKey(
  'draft',
  z.object({ note: z.string(), pinned: z.boolean() }).default({ note: '', pinned: false }),
)

/** Counted for this tab alone. */
export const visits = storedKey('visits', z.number().int().nonnegative().default(0), {
  storage: 'session',
})

/** The depth units the survey review and the inspection planner show. */
export const units = storedKey('units', z.enum(['metric', 'imperial']).default('metric'), {
  storage: 'user',
})

/** The well and survey under review; Fieldwork's inspection planner reads it. */
export const wellSelection = storedKey(
  'well-selection',
  z
    .strictObject({
      wellId: z.string(),
      runId: z.string().nullable(),
      comparisonMode: z.enum(['baseline', 'overlay']).default('baseline'),
    })
    .nullable()
    .default(null),
  { storage: 'user' },
)
