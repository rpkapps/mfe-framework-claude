/**
 * The listing rules every host applies to the registry, written once because two surfaces
 * disagreeing about whether a hidden entry is offered is a bug nobody can see in either one alone.
 * `hidden` is a listing rule, not a security boundary: a hidden App reached by URL still mounts.
 * Each adapter wraps these in its own reactive primitive.
 */

import type {
  CapabilityDescriptor,
  CapabilityName,
  Registry,
  RegistryEntry,
} from '@company/mfe-core'

export interface CapabilityPage {
  readonly app: RegistryEntry
  readonly capability: CapabilityDescriptor
}

export interface ActiveDefinition {
  /** The id in the URL, the one fact that is always true. */
  readonly id: string
  /** Undefined when the URL names an App the registry does not know. */
  readonly entry: RegistryEntry | undefined
}

interface RegistryViews {
  readonly entries: readonly RegistryEntry[]
  readonly apps: readonly RegistryEntry[]
  readonly widgets: readonly RegistryEntry[]
  /** Keyed by the capability asked for, or `undefined` for every page; filled on first request. */
  readonly pages: Map<CapabilityName | undefined, readonly CapabilityPage[]>
}

/**
 * The registry does not change after boot, so each list is computed once per registry and every
 * component reads the same frozen array, rather than each one copying the whole registry. Weak, so
 * a disposed runtime's registry takes its lists with it.
 */
const views = new WeakMap<Registry, RegistryViews>()

function viewsOf(registry: Registry): RegistryViews {
  const cached = views.get(registry)
  if (cached !== undefined) return cached

  const entries = Object.freeze([...registry.entries.values()])
  const listed = (kind: RegistryEntry['definitionKind']): readonly RegistryEntry[] =>
    Object.freeze(entries.filter(entry => entry.definitionKind === kind && entry.hidden !== true))

  const created: RegistryViews = {
    entries,
    apps: listed('app'),
    widgets: listed('widget'),
    pages: new Map(),
  }
  views.set(registry, created)
  return created
}

/** Every accepted entry, in registry order. */
export function listEntries(registry: Registry): readonly RegistryEntry[] {
  return viewsOf(registry).entries
}

export function listApps(registry: Registry): readonly RegistryEntry[] {
  return viewsOf(registry).apps
}

export function listWidgets(registry: Registry): readonly RegistryEntry[] {
  return viewsOf(registry).widgets
}

/** Unfiltered flattening would put every page under whichever heading was written first. */
export function capabilityPages(
  registry: Registry,
  name?: CapabilityName,
): readonly CapabilityPage[] {
  const { apps, pages } = viewsOf(registry)
  const cached = pages.get(name)
  if (cached !== undefined) return cached

  const flattened = Object.freeze(
    apps.flatMap(app =>
      (app.capabilities ?? [])
        .filter(capability => name === undefined || capability.name === name)
        .map(capability => ({ app, capability })),
    ),
  )
  pages.set(name, flattened)
  return flattened
}

/**
 * The App a boundary id names, as `boundaryDefinitionId` reads it from a location, or `null` on a
 * page the host owns. A Widget is never mounted at a boundary, so an id naming one counts as
 * unknown.
 */
export function activeDefinition(
  registry: Registry,
  id: string | undefined,
): ActiveDefinition | null {
  if (id === undefined) return null
  const entry = registry.entries.get(id)
  return { id, entry: entry?.definitionKind === 'app' ? entry : undefined }
}
