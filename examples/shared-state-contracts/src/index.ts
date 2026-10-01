import { z } from 'zod'

/** Owned by this package; consumers import it rather than declaring their own copies. */
export const sharedStateSchema = z.object({
  'display:units': z.enum(['metric', 'imperial']).default('metric'),
  'well:selection': z
    .strictObject({
      wellId: z.string(),
      runId: z.string().nullable(),
      comparisonMode: z.enum(['baseline', 'overlay']).default('baseline'),
    })
    .nullable()
    .default(null),
})
