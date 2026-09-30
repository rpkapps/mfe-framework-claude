import { createMfeError } from '@company/mfe-core'
import { describe, expect, it } from 'vitest'

import { definitionRecovery } from './error-recovery.ts'

describe('host recovery actions', () => {
  it('offers reload for a lazy chunk failure reported after the feature mounted', () => {
    const chunk = new Error('Loading chunk 23 failed')
    chunk.name = 'ChunkLoadError'
    const error = createMfeError({
      code: 'mount/failure',
      id: 'panel',
      operation: 'render',
      cause: chunk,
    })
    expect(definitionRecovery(error)).toBe('reload')
    const transient = createMfeError({
      code: 'mount/failure',
      id: 'panel',
      operation: 'render',
      cause: new Error('temporary failure'),
    })
    expect(definitionRecovery(transient)).toBe('retry')
  })

  it('offers retry for temporary failures, input correction for bad values and reload for a fixed registry', () => {
    const error = (code: Parameters<typeof createMfeError>[0]['code']) =>
      createMfeError({ code, id: 'panel', operation: 'load Widget' })
    expect(definitionRecovery(error('load/timeout'))).toBe('retry')
    expect(definitionRecovery(error('contract/input-mismatch'))).toBe('correct-inputs')
    expect(definitionRecovery(error('registry/invalid-entry'))).toBe('reload')
    expect(definitionRecovery(error('contract/unsupported-major'))).toBe('incompatible')
  })
})
