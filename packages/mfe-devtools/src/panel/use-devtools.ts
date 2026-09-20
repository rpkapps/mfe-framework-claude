/**
 * What the panel reads from the runtime.
 *
 * Hooks, not components, so the modules beside this one can each export only
 * components and stay React Refresh boundaries. Every value here is derived at
 * render from the registry the runtime already holds — nothing is copied into
 * state, cached or subscribed to, which is what keeps an open panel free and a
 * closed one absent.
 */

import { useMemo } from 'react'
import { containerNameOf, useRegistryEntries } from '@company/mfe-react'

/**
 * Every accepted entry, in registry order. The framework's own selector, named
 * here so the tabs beside this module go on reading everything they render
 * through one import — and so the panel and its host cannot end up with two
 * different ideas of what the registry holds.
 */
export { useRegistryEntries }

/**
 * The overrides that actually applied, read back off the registry rather than from
 * the host.
 *
 * `normalizeRegistry` stamps `overridden` on an entry whose manifest URL a
 * developer override replaced at boot, so the entries themselves are the record
 * of what applied. Taking it from there rather than from a value the shell
 * happens to expose is what lets this package work in any host: it reports what
 * the runtime did, not what something asked it to do.
 */
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
