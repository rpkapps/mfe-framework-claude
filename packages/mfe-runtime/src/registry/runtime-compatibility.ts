/** Read the stable compatibility envelope before interpreting adapter-specific entry formats. */

import { isRecord } from '@company/mfe-core'
import {
  assertRuntimeCompatibility,
  RUNTIME_API_VERSION,
} from '@company/mfe-core/runtime-compatibility'

export function assertRegistryRuntimeCompatibility(raw: unknown, id: string): void {
  if (!isRecord(raw)) return
  assertRuntimeCompatibility(
    { apiVersion: RUNTIME_API_VERSION },
    {
      id,
      ...(typeof raw['version'] === 'string' ? { version: raw['version'] } : {}),
      requiresRuntime: raw['requiresRuntime'],
    },
  )
}
