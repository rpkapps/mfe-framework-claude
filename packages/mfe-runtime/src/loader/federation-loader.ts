/**
 * The Module Federation container loader, neutral because nothing in it depends on which adapter
 * built the container: it registers the remote an entry names, evaluates the exposed module and
 * returns the branded definition inside. The federation runtime is handed in rather than
 * imported, so this package never resolves Module Federation itself (§6).
 */

import {
  createMfeError,
  isBrandedDefinition,
  toMfeError,
  type BrandedDefinition,
  type RegistryEntry,
} from '@company/mfe-core'

import type { ContainerLoader, LoadedDefinition } from './container-loader.ts'

/**
 * An entry a federation build published. Each adapter's own entry type extends this, so the
 * loader reaches the container name without knowing which adapter parsed the entry.
 */
export interface FederatedRegistryEntry extends RegistryEntry {
  readonly container: string
  /** Absent when the build left the expose path to the framework convention. */
  readonly expose?: string
}

/** Structural, so every adapter's federated entries qualify without registering anywhere. */
export function isFederatedEntry(entry: RegistryEntry): entry is FederatedRegistryEntry {
  const container = (entry as { readonly container?: unknown }).container
  return typeof container === 'string' && container !== ''
}

/** The expose path a build leaves to the framework convention. */
export function federationTarget(entry: FederatedRegistryEntry): {
  container: string
  expose: string
} {
  return {
    container: entry.container,
    expose: entry.expose ?? (entry.definitionKind === 'app' ? './app' : `./widgets/${entry.id}`),
  }
}

/** The subset of the federation runtime this loader uses. */
export interface FederationRuntime {
  registerRemotes(
    remotes: readonly { name: string; entry: string }[],
    options?: { force?: boolean },
  ): void
  loadRemote<T>(id: string): Promise<T | null>
}

/**
 * Nothing here wraps a load: an adapter that needs page state hidden while its containers
 * evaluate says so through `MfeAdapter.aroundLoad`, which the runtime applies around this loader.
 */
export interface FederationLoaderOptions {
  /** Injected so this module has no import-time side effects and tests need no real runtime. */
  readonly runtime: FederationRuntime
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
export function createFederationContainerLoader(
  options: FederationLoaderOptions,
): ContainerLoader<BrandedDefinition> {
  const registered = new Set<string>()

  return {
    load: async (entry, { signal }): Promise<LoadedDefinition<BrandedDefinition>> => {
      signal.throwIfAborted()

      if (!isFederatedEntry(entry)) {
        throw createMfeError({
          code: 'registry/invalid-entry',
          id: entry.id,
          operation: 'resolve federation container',
          expected: 'an entry naming the federation container it was built into',
          observed: `an entry the ${entry.adapter} adapter parsed, which names none`,
          repair: 'Load the entry through the loader of the adapter that parsed it.',
        })
      }

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
        moduleExports = await options.runtime.loadRemote(
          `${containerName}/${expose.replace(/^\.\//, '')}`,
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
}

/** A default export is allowed only when the module holds exactly one definition. */
function extractDefinition(moduleExports: unknown, id: string): BrandedDefinition {
  if (isBrandedDefinition(moduleExports)) return moduleExports

  if (moduleExports !== null && typeof moduleExports === 'object') {
    const candidates = Object.values(moduleExports).filter(isBrandedDefinition)

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
