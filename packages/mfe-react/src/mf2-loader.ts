/**
 * The Module Federation container loader, the one place in the framework that knows federation
 * exists: the neutral host orchestrates loading through a port and this implements it (§6).
 */

import { createMfeError, toMfeError, type RegistryEntry } from '@company/mfe-core'
import type { ContainerLoader, LoadedDefinition } from '@company/mfe-host'

import { isMfeDefinition, type MfeDefinition } from './definition.ts'
import { reactAdapter } from './registry/react-adapter.ts'

/** The subset of the federation runtime this loader uses. */
interface FederationRuntime {
  registerRemotes(
    remotes: readonly { name: string; entry: string }[],
    options?: { force?: boolean },
  ): void
  loadRemote<T>(id: string): Promise<T | null>
}

export interface Mf2LoaderOptions {
  /** Injected so this module has no import-time side effects and tests need no real runtime. */
  readonly runtime: FederationRuntime
}

/** The container name is the React adapter's own field, so a caller asks here rather than casting. */
export function containerNameOf(entry: RegistryEntry): string | undefined {
  return reactAdapter.is(entry) && entry.container !== '' ? entry.container : undefined
}

/** The expose path a build leaves to the framework convention. */
function federationTarget(entry: RegistryEntry): { container: string; expose: string } {
  if (!reactAdapter.is(entry)) {
    throw createMfeError({
      code: 'registry/invalid-entry',
      id: entry.id,
      operation: 'resolve federation container',
      expected: 'an entry the React adapter parsed',
      observed: `an entry the ${entry.adapter} adapter parsed`,
      repair: 'Load the entry through the adapter that parsed it.',
    })
  }

  return {
    container: entry.container,
    expose: entry.expose ?? (entry.definitionKind === 'app' ? './app' : `./widgets/${entry.id}`),
  }
}

/**
 * Hides `window.__TSR_ROUTER__` while a container's modules evaluate: the router plugin's
 * development HMR shim reads it back and, finding the shell's `__root__` registered under the
 * same id, copies the shell's component onto the App that just mounted. It is restored only if
 * nothing published a newer router meanwhile, which would resurrect a stale reference.
 */
async function withoutCurrentRouterGlobal<T>(load: () => Promise<T>): Promise<T> {
  const owner = globalThis as { __TSR_ROUTER__?: unknown }
  if (!('__TSR_ROUTER__' in owner)) return await load()

  const previous = owner.__TSR_ROUTER__
  delete owner.__TSR_ROUTER__

  try {
    return await load()
  } finally {
    if (!('__TSR_ROUTER__' in owner)) owner.__TSR_ROUTER__ = previous
  }
}

/**
 * Module Federation reports a container it could not find at all as `RUNTIME-003`, in the
 * message of a plain Error, which is the only machine-readable part of it.
 */
const MANIFEST_ERROR_CODE = '#RUNTIME-003'

function isManifestFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MANIFEST_ERROR_CODE)
}

/** Registration is idempotent per container, so an override must be consistent across it. */
export function createMf2ContainerLoader(options: Mf2LoaderOptions): ContainerLoader {
  const registered = new Set<string>()

  const loader: ContainerLoader<MfeDefinition> = {
    load: async (entry, { signal }): Promise<LoadedDefinition<MfeDefinition>> => {
      signal.throwIfAborted()

      const { container: containerName, expose } = federationTarget(entry)

      if (!registered.has(containerName)) {
        try {
          options.runtime.registerRemotes([{ name: containerName, entry: entry.manifestUrl }])
          registered.add(containerName)
        } catch (error) {
          throw toMfeError(error, {
            code: 'load/manifest-failure',
            id: entry.id,
            operation: 'register federation container',
            repair: `Check that ${entry.manifestUrl} is reachable and serves a valid manifest.`,
          })
        }
      }

      let moduleExports: unknown
      try {
        moduleExports = await withoutCurrentRouterGlobal(() =>
          options.runtime.loadRemote(`${containerName}/${expose.replace(/^\.\//, '')}`),
        )
      } catch (error) {
        throw toMfeError(
          error,
          isManifestFailure(error)
            ? {
                code: 'load/manifest-failure',
                id: entry.id,
                operation: 'load the container manifest',
                repair: `Check that ${entry.manifestUrl} is reachable and serves a valid manifest.`,
              }
            : {
                code: 'load/entry-failure',
                id: entry.id,
                operation: 'load federation entry',
                repair:
                  'Check the browser network panel for the failed chunk. A container that resolved its own copy of a shared singleton fails differently: it loads, and a framework hook inside it then reports being rendered outside any mount.',
              },
        )
      }

      signal.throwIfAborted()

      const definition = extractDefinition(moduleExports, entry.id)

      if (definition.kind !== entry.definitionKind) {
        throw createMfeError({
          code: 'registry/invalid-entry',
          id: entry.id,
          operation: 'load definition',
          expected: `a ${entry.definitionKind} definition, as the registry entry says`,
          observed: `a ${definition.kind} definition`,
          repair: 'Rebuild the container so its registry entry matches what src/mfe.ts exports.',
        })
      }

      return {
        identity: {
          id: definition.id,
          kind: definition.kind,
          ...(definition.version === undefined ? {} : { version: definition.version }),
        },
        module: definition,
      }
    },
  }

  return loader
}

/** A default export is allowed only when the module holds exactly one definition. */
function extractDefinition(moduleExports: unknown, id: string): MfeDefinition {
  if (isMfeDefinition(moduleExports)) return moduleExports

  if (moduleExports !== null && typeof moduleExports === 'object') {
    const candidates = Object.values(moduleExports).filter(isMfeDefinition)

    const byId = candidates.find(definition => definition.id === id)
    if (byId) return byId
    if (candidates.length === 1 && candidates[0]) return candidates[0]

    if (candidates.length > 1) {
      throw createMfeError({
        code: 'load/entry-failure',
        id,
        operation: 'resolve definition from the federation entry',
        expected: `exactly one definition, or one whose id is "${id}"`,
        observed: `${candidates.length} definitions (${candidates.map(c => c.id).join(', ')})`,
        repair: 'Rebuild the container; the generated entry exposes one definition per path.',
      })
    }
  }

  throw createMfeError({
    code: 'load/entry-failure',
    id,
    operation: 'resolve definition from the federation entry',
    expected: 'a module exporting a createApp or createWidget result',
    observed: moduleExports === null ? 'null' : `a ${typeof moduleExports}`,
    repair: 'Export the definition from src/mfe.ts and rebuild the container.',
  })
}
