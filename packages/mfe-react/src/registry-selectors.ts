/**
 * Reading the registry from a host component, through the runtime's listing rules, which every
 * adapter shares. Each list is the same array for as long as the registry lives, so a component
 * that reads one re-renders only when something else changed.
 */

import { useMemo } from 'react'
import type { CapabilityName, RegistryEntry } from '@company/mfe-core'
import {
  activeDefinition,
  boundaryDefinitionId,
  capabilityPages,
  listApps,
  listEntries,
  listWidgets,
  type ActiveDefinition,
  type CapabilityPage,
} from '@company/mfe-runtime'

import { useMfeRuntime } from './runtime-context.tsx'

export type { ActiveDefinition, CapabilityPage } from '@company/mfe-runtime'

/** Every accepted entry, in registry order. */
export function useRegistryEntries(): readonly RegistryEntry[] {
  return listEntries(useMfeRuntime('a registry view').registry)
}

/** A hidden App reached by URL still mounts; it is only left out of listings. */
export function useApps(): readonly RegistryEntry[] {
  return listApps(useMfeRuntime('a registry view').registry)
}

export function useWidgets(): readonly RegistryEntry[] {
  return listWidgets(useMfeRuntime('a registry view').registry)
}

export function useCapabilityPages(name?: CapabilityName): readonly CapabilityPage[] {
  return capabilityPages(useMfeRuntime('a registry view').registry, name)
}

/**
 * The App the given location is inside, or `null` on a page the host owns; the location is a
 * parameter because the host owns its router (§26).
 */
export function useActiveDefinition(location: string): ActiveDefinition | null {
  const { registry } = useMfeRuntime('the active definition')
  const id = boundaryDefinitionId(location)

  return useMemo(() => activeDefinition(registry, id), [registry, id])
}
