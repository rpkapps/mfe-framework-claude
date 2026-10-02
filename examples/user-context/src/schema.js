import labSchema from '../../lab/user-context.schema.json' with { type: 'json' }
import fieldworkSchema from '../../fieldwork/user-context.schema.json' with { type: 'json' }

/** Host aggregation only: each MFE publishes and owns its individual schema artifact. */
export const schema = {
  formatVersion: 1,
  contracts: [...labSchema.contracts, ...fieldworkSchema.contracts],
}
