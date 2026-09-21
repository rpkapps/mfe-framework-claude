/**
 * What the panel reads from the runtime, as hooks rather than components, so the modules beside
 * this one can export only components and stay React Refresh boundaries (§18).
 */

import { useMemo } from 'react'
import { containerNameOf, useRegistryEntries } from '@company/mfe-react'

/** The framework's own selector, so the panel and its host cannot disagree about what the registry holds. */
export { useRegistryEntries }

/** Read off the `overridden` stamps rather than from the host, so it reports what the runtime did. */
export function useActiveOverrides(): ReadonlyMap<string, string> {
  const entries = useRegistryEntries()

  return useMemo(() => {
    const active = new Map<string, string>()
    for (const entry of entries) {
      if (entry.overridden === true) active.set(entry.id, entry.manifestUrl)
    }
    return active
  }, [entries])
}

/** Definition id → federation container, for spotting a conflict before a write. */
export function useContainerLookup(): (id: string) => string | undefined {
  const entries = useRegistryEntries()

  return useMemo(() => {
    const byId = new Map<string, string>()
    for (const entry of entries) {
      const container = containerNameOf(entry)
      if (container !== undefined) byId.set(entry.id, container)
    }
    return (id: string) => byId.get(id)
  }, [entries])
}
