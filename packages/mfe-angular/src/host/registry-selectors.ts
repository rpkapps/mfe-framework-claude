/**
 * Reading the registry from a host component, through the runtime's listing rules, which every
 * adapter shares. The registry does not change after boot, so each view is the same array for as
 * long as it lives and stays referentially stable for its consumers.
 */

import { assertInInjectionContext, computed, signal, type Signal } from '@angular/core'
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

import { injectMfeRuntime } from '../inject/runtime.ts'

export type { ActiveDefinition, CapabilityPage } from '@company/mfe-runtime'

/** Every accepted entry, in registry order. */
export function injectRegistryEntries(): Signal<readonly RegistryEntry[]> {
  assertInInjectionContext(injectRegistryEntries)
  const { registry } = injectMfeRuntime('a registry view')
  return signal(listEntries(registry)).asReadonly()
}

/** A hidden App reached by URL still mounts; it is only left out of listings. */
export function injectApps(): Signal<readonly RegistryEntry[]> {
  assertInInjectionContext(injectApps)
  const { registry } = injectMfeRuntime('a registry view')
  return signal(listApps(registry)).asReadonly()
}

export function injectWidgets(): Signal<readonly RegistryEntry[]> {
  assertInInjectionContext(injectWidgets)
  const { registry } = injectMfeRuntime('a registry view')
  return signal(listWidgets(registry)).asReadonly()
}

export function injectCapabilityPages(name?: CapabilityName): Signal<readonly CapabilityPage[]> {
  assertInInjectionContext(injectCapabilityPages)
  const { registry } = injectMfeRuntime('a registry view')
  return signal(capabilityPages(registry, name)).asReadonly()
}

/**
 * The App the given location is inside, or `null` on a page the host owns. The location is a
 * signal the host supplies, because the host owns its router.
 */
export function injectActiveDefinition(location: Signal<string>): Signal<ActiveDefinition | null> {
  assertInInjectionContext(injectActiveDefinition)
  const { registry } = injectMfeRuntime('the active definition')

  // Recomputed only when the boundary id changes, so a move inside one App notifies nobody.
  const id = computed(() => boundaryDefinitionId(location()))
  return computed(() => activeDefinition(registry, id()))
}
