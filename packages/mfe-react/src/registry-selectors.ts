/**
 * Reading the registry from a host component, written once because two surfaces disagreeing
 * about whether a hidden entry is offered is a bug nobody can see in either one alone (§26).
 */

import { useMemo } from 'react'
import type { CapabilityDescriptor, CapabilityName, NeutralRegistryEntry } from '@company/mfe-core'
import { boundaryDefinitionId } from '@company/mfe-host'

import { useMfeRuntime } from './runtime-context.tsx'

/** Every accepted entry, in registry order. */
export function useRegistryEntries(): readonly NeutralRegistryEntry[] {
  const { entries } = useMfeRuntime('a registry view').registry
  return useMemo(() => [...entries.values()], [entries])
}

/** `hidden` is a listing rule, not a security boundary: a hidden App reached by URL mounts. */
export function useApps(): readonly NeutralRegistryEntry[] {
  const entries = useRegistryEntries()
  return useMemo(
    () => entries.filter(entry => entry.definitionKind === 'app' && entry.hidden !== true),
    [entries],
  )
}

export function useWidgets(): readonly NeutralRegistryEntry[] {
  const entries = useRegistryEntries()
  return useMemo(
    () => entries.filter(entry => entry.definitionKind === 'widget' && entry.hidden !== true),
    [entries],
  )
}

export interface CapabilityPage {
  readonly app: NeutralRegistryEntry
  readonly capability: CapabilityDescriptor
}

/** Unfiltered flattening would put every page under whichever heading was written first. */
export function useCapabilityPages(name?: CapabilityName): readonly CapabilityPage[] {
  const apps = useApps()
  return useMemo(
    () =>
      apps.flatMap(app =>
        (app.capabilities ?? [])
          .filter(capability => name === undefined || capability.name === name)
          .map(capability => ({ app, capability })),
      ),
    [apps, name],
  )
}

export interface ActiveDefinition {
  /** The id in the URL, the one fact that is always true. */
  readonly id: string
  /** Undefined when the URL names an App the registry does not know. */
  readonly entry: NeutralRegistryEntry | undefined
}

/**
 * The App the given location is inside, or `null` on a page the host owns; the location is a
 * parameter because the host owns its router (§26).
 */
export function useActiveDefinition(location: string): ActiveDefinition | null {
  const { entries } = useMfeRuntime('the active definition').registry
  const id = boundaryDefinitionId(location)

  return useMemo(() => {
    if (id === undefined) return null

    // A Widget is never mounted at a boundary, so an id naming one counts as unknown.
    const entry = entries.get(id)
    return { id, entry: entry?.definitionKind === 'app' ? entry : undefined }
  }, [entries, id])
}
