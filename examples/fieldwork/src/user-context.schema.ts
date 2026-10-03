import { z } from 'zod'

// The widget owns its saved brief while explicitly reading Lab's selection.
export const inspectionUserContextSchema = z.object({
  brief: z
    .object({ wellId: z.string(), runId: z.string(), text: z.string() })
    .nullable()
    .default(null),
})
/** Consumers declare only the fields they need, without importing Lab's owned schema. */
const selectionReadSchema = z
  .object({
    wellId: z.string(),
    runId: z.string().nullable(),
    comparisonMode: z.enum(['baseline', 'overlay']),
  })
  .nullable()
export const labReadSchema = z.object({
  units: z.enum(['metric', 'imperial']),
  'well-selection': selectionReadSchema,
})
// The App's resolver needs only the selection; the Widget also displays units.
export const labSelectionReadSchema = z.object({ 'well-selection': selectionReadSchema })
export type LabUserContext = z.infer<typeof labSelectionReadSchema>
