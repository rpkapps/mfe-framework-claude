/** Data and recovery controls passed to a host's own error template. */

import type { MfeError } from '@company/mfe-core'
import { definitionRecovery, type DefinitionRecovery } from '@company/mfe-runtime'

export interface MfeFallbackContext {
  readonly $implicit: MfeError
  readonly error: MfeError
  readonly attempt: number
  readonly recovery: DefinitionRecovery
  readonly retry: () => void
  readonly reload: () => void
}

export function createFallbackContext(
  error: MfeError,
  attempt: number,
  retry: () => void,
  reload: () => void,
): MfeFallbackContext {
  return { $implicit: error, error, attempt, recovery: definitionRecovery(error), retry, reload }
}
