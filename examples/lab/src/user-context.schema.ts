import { z } from 'zod'

/** Lab owns this slice. Other MFEs explicitly declare compatible read requirements. */
export const userContextSchema = z.object({
  units: z.enum(['metric', 'imperial']).default('metric'),
  'well-selection': z
    .strictObject({
      wellId: z.string(),
      runId: z.string().nullable(),
      comparisonMode: z.enum(['baseline', 'overlay']).default('baseline'),
    })
    .nullable()
    .default(null),
})
export type LabUserContext = z.infer<typeof userContextSchema>
