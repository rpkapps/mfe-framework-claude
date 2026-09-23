import type { CapabilityName, RegistryEntry } from '@company/mfe-core'

/** The capability lookup, written once in the neutral host (§26); a Widget has none. */
export function capabilityRoute(entry: RegistryEntry, name: CapabilityName): string | undefined {
  return entry.capabilities?.find(capability => capability.name === name)?.path
}
