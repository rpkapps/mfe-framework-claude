/**
 * Reading the registry from a host component, with the rules every host applies:
 * `hidden` is a listing rule, not a security boundary, and a Widget is never a boundary. The
 * registry does not change after boot, so each view is computed once and stays referentially
 * stable for its consumers.
 */

import { assertInInjectionContext, computed, signal, type Signal } from '@angular/core'
import type { CapabilityDescriptor, CapabilityName, RegistryEntry } from '@company/mfe-core'
import { boundaryDefinitionId } from '@company/mfe-runtime'

import { injectMfeRuntime } from '../inject/runtime.ts'

/** Every accepted entry, in registry order. */
export function injectRegistryEntries(): Signal<readonly RegistryEntry[]> {
  assertInInjectionContext(injectRegistryEntries)
  const { entries } = injectMfeRuntime('a registry view').registry
  return signal<readonly RegistryEntry[]>([...entries.values()]).asReadonly()
}

/** A hidden App reached by URL still mounts; it is only left out of listings. */
export function injectApps(): Signal<readonly RegistryEntry[]> {
  assertInInjectionContext(injectApps)
  const entries = injectRegistryEntries()
  return computed(() =>
    entries().filter(entry => entry.definitionKind === 'app' && entry.hidden !== true),
  )
}

export function injectWidgets(): Signal<readonly RegistryEntry[]> {
  assertInInjectionContext(injectWidgets)
  const entries = injectRegistryEntries()
  return computed(() =>
    entries().filter(entry => entry.definitionKind === 'widget' && entry.hidden !== true),
  )
}

export interface CapabilityPage {
  readonly app: RegistryEntry
  readonly capability: CapabilityDescriptor
}

/** Unfiltered flattening would put every page under whichever heading was written first. */
export function injectCapabilityPages(name?: CapabilityName): Signal<readonly CapabilityPage[]> {
  assertInInjectionContext(injectCapabilityPages)
  const apps = injectApps()
  return computed(() =>
    apps().flatMap(app =>
      (app.capabilities ?? [])
        .filter(capability => name === undefined || capability.name === name)
        .map(capability => ({ app, capability })),
    ),
  )
}

export interface ActiveDefinition {
  /** The id in the URL, the one fact that is always true. */
  readonly id: string
  /** Undefined when the URL names an App the registry does not know. */
  readonly entry: RegistryEntry | undefined
}

/**
 * The App the given location is inside, or `null` on a page the host owns. The location is a
 * signal the host supplies, because the host owns its router.
 */
export function injectActiveDefinition(location: Signal<string>): Signal<ActiveDefinition | null> {
  assertInInjectionContext(injectActiveDefinition)
  const { entries } = injectMfeRuntime('the active definition').registry

  const id = computed(() => boundaryDefinitionId(location()))
  return computed(() => {
    const current = id()
    if (current === undefined) return null

    // A Widget is never mounted at a boundary, so an id naming one counts as unknown.
    const entry = entries.get(current)
    return { id: current, entry: entry?.definitionKind === 'app' ? entry : undefined }
  })
}
