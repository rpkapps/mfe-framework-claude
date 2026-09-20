/**
 * Reading the registry from a host component.
 *
 * The filters are not the interesting part; agreeing on them is. Two surfaces
 * in one shell disagreeing about whether a hidden entry is offered is a bug
 * nobody can see in either one alone. These select and nothing else: what an
 * entry looks like is the host's, and stays there.
 */

import { useMemo } from 'react'
import type { CapabilityDescriptor, CapabilityName, NeutralRegistryEntry } from '@company/mfe-core'
import { boundaryDefinitionId } from '@company/mfe-host'

import { useMfeRuntime } from './runtime-context.tsx'

/** Every accepted entry, in registry order. What a diagnostics view lists. */
export function useRegistryEntries(): readonly NeutralRegistryEntry[] {
  const { entries } = useMfeRuntime('a registry view').registry
  return useMemo(() => [...entries.values()], [entries])
}

/**
 * The Apps a host offers: routable, and not opted out of being listed. `hidden`
 * is a listing rule, not a security boundary — a hidden App reached by URL is
 * still mounted and still named.
 */
export function useApps(): readonly NeutralRegistryEntry[] {
  const entries = useRegistryEntries()
  return useMemo(
    () => entries.filter(entry => entry.definitionKind === 'app' && entry.hidden !== true),
    [entries],
  )
}

/** The Widgets a host offers: non-routable, and not opted out of being listed. */
export function useWidgets(): readonly NeutralRegistryEntry[] {
  const entries = useRegistryEntries()
  return useMemo(
    () => entries.filter(entry => entry.definitionKind === 'widget' && entry.hidden !== true),
    [entries],
  )
}

/** One App's capability page, with the App that published it. */
export interface CapabilityPage {
  readonly app: NeutralRegistryEntry
  readonly capability: CapabilityDescriptor
}

/**
 * Every capability page the listed Apps publish, flattened, and filtered to one
 * capability when a name is given. The filter is the reason this exists: a host
 * renders these under a heading that names one of them, and flattening without
 * filtering puts every page under whichever heading was written first. `label`
 * is not defaulted — the registry quarantines an entry that publishes none.
 */
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

/** What the URL says is mounted, and what the registry knows about it. */
export interface ActiveDefinition {
  /** The id in the URL, which is the one fact that is always true. */
  readonly id: string
  /** Undefined when the URL names an App the registry does not know. */
  readonly entry: NeutralRegistryEntry | undefined
}

/**
 * The App the given location is inside, or `null` on a page the host owns.
 *
 * The location is a parameter because the host owns its router; the answer is
 * derived from the path rather than from a route parameter, so it is the same
 * answer a navigation blocker gets about the same URL. An id the registry does
 * not know still comes back, with no entry, because the boundary below is
 * already reporting that it could not be loaded.
 */
export function useActiveDefinition(location: string): ActiveDefinition | null {
  const { entries } = useMfeRuntime('the active definition').registry
  const id = boundaryDefinitionId(location)

  return useMemo(() => {
    if (id === undefined) return null

    // A Widget is never mounted at a boundary, so an id that names one is as
    // unknown here as an id that names nothing.
    const entry = entries.get(id)
    return { id, entry: entry?.definitionKind === 'app' ? entry : undefined }
  }, [entries, id])
}
