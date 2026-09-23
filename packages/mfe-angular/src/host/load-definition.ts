/**
 * Resolving a definition from the registry for a host component. A rejection stays cached, so
 * every host of one id sees the same settled failure rather than refetching as fast as the
 * network allows; `forgetDefinition` is how a retry makes the next attempt a fresh one.
 */

import { toMfeError, type DefinitionKind } from '@company/mfe-core'
import {
  isMountableDefinition,
  type MfeHostRuntime,
  type MountableAppDefinition,
  type MountableDefinition,
  type MountableWidgetDefinition,
} from '@company/mfe-runtime'

const loadsByRuntime = new WeakMap<MfeHostRuntime, Map<string, Promise<MountableDefinition>>>()

export function loadDefinition(
  runtime: MfeHostRuntime,
  id: string,
  kind: 'app',
): Promise<MountableAppDefinition>
export function loadDefinition(
  runtime: MfeHostRuntime,
  id: string,
  kind: 'widget',
): Promise<MountableWidgetDefinition>
export function loadDefinition(
  runtime: MfeHostRuntime,
  id: string,
  kind: DefinitionKind,
): Promise<MountableDefinition> {
  let loads = loadsByRuntime.get(runtime)
  if (!loads) {
    loads = new Map()
    loadsByRuntime.set(runtime, loads)
  }

  const cached = loads.get(id)
  if (cached) return cached

  const label = kind === 'app' ? 'App' : 'Widget'
  const entry = runtime.registry.entries.get(id)

  const pending = (async (): Promise<MountableDefinition> => {
    if (!entry) {
      throw toMfeError(null, {
        code: 'registry/invalid-entry',
        id,
        operation: `resolve ${label}`,
        observed: 'no registry entry with this id',
        repair:
          'Check the id against the generated registry entry, or add a localStorage override pointing at your dev server.',
      })
    }

    const loaded = await runtime.loader.load(entry, { signal: new AbortController().signal })
    const definition = loaded.module

    if (!isMountableDefinition(definition) || definition.kind !== kind) {
      throw toMfeError(null, {
        code: 'load/entry-failure',
        id,
        operation: `resolve ${label}`,
        expected: `a definition created with create${label}`,
        observed: !isMountableDefinition(definition)
          ? 'a module that is not a mountable framework definition'
          : kind === 'app'
            ? 'a Widget definition, which owns no URL boundary'
            : 'an App definition',
        repair: `Export the ${label} from src/mfe.ts and rebuild the container.`,
      })
    }

    return definition
  })()

  // Marks the rejection handled without dropping it, and reports off the cached promise so one
  // attempt is one diagnostic however many hosts wait on it.
  pending.catch((error: unknown) => {
    runtime.diagnostics.report(
      toMfeError(error, { code: 'load/entry-failure', id, operation: `resolve ${label}` }),
    )
  })
  loads.set(id, pending)
  return pending
}

/** Drops a cached outcome so the next load is a genuinely fresh attempt. */
export function forgetDefinition(runtime: MfeHostRuntime, id: string): void {
  loadsByRuntime.get(runtime)?.delete(id)
}
