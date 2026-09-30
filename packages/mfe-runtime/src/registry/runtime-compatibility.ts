/** Read the stable compatibility envelope before interpreting adapter-specific entry formats. */

import { createMfeError, isRecord } from '@company/mfe-core'
import {
  assertRuntimeCompatibility,
  isRuntimeRequirement,
  RUNTIME_API_VERSION,
} from '@company/mfe-core/runtime-compatibility'

export function assertRegistryRuntimeCompatibility(raw: unknown, id: string): void {
  if (!isRecord(raw)) return
  const requiresRuntime = raw['requiresRuntime']
  if (requiresRuntime !== undefined && !isRuntimeRequirement(requiresRuntime)) {
    throw createMfeError({
      code: 'registry/invalid-entry',
      id,
      operation: 'read registry entry',
      path: ['requiresRuntime'],
      expected: 'a generated stable SemVer comparator range, such as ">=1.1.0 <2.0.0"',
      repair: 'Rebuild the container; the registry entry is generated, never hand-written.',
    })
  }
  assertRuntimeCompatibility(
    { apiVersion: RUNTIME_API_VERSION },
    {
      id,
      ...(typeof raw['version'] === 'string' ? { version: raw['version'] } : {}),
      ...(requiresRuntime === undefined ? {} : { requiresRuntime }),
    },
  )
}
