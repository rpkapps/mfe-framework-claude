import { z } from 'zod'

// This widget only reads Lab; its inspection draft stays local to the mounted panel.
export const inspectionUserContextSchema = z.object({})
export const fieldworkUserContextSchema = z.object({
  'inspection:showCompleted': z.boolean().default(false),
})
/** This is Fieldwork's explicit read requirement, independent of Lab's source package. */
export const labReadSchema = z.object({
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
export type LabUserContext = z.infer<typeof labReadSchema>
