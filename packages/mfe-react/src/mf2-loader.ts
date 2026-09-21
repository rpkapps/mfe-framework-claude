/**
 * The Module Federation container loader, the one place in the framework that knows federation
 * exists: the neutral host orchestrates loading through a port and this implements it (§6).
 */

import { createMfeError, toMfeError, type NeutralRegistryEntry } from '@company/mfe-core'
import type { ContainerLoader, LoadedDefinition } from '@company/mfe-host'

import { isMfeDefinition, type MfeDefinition } from './definition.ts'

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

/** The neutral record keeps this in `adapterData`, so a caller asks here rather than casting. */
export function containerNameOf(entry: NeutralRegistryEntry): string | undefined {
  const data = entry.adapterData as { containerName?: unknown } | undefined
  return typeof data?.containerName === 'string' && data.containerName !== ''
    ? data.containerName
    : undefined
}

function readAdapterData(entry: NeutralRegistryEntry): {
  containerName: string
  exposeName: string
} {
  const data = entry.adapterData as { containerName?: unknown; exposeName?: unknown } | undefined

  if (typeof data?.containerName !== 'string' || data.containerName === '') {
    throw createMfeError({
      code: 'registry/invalid-descriptor',
      id: entry.id,
      operation: 'resolve federation container',
      expected: 'a container name in the generated registry descriptor',
      observed: 'none',
      repair: 'Rebuild the container; registry JSON is generated, never hand-written.',
    })
  }

  const exposeName =
    typeof data.exposeName === 'string' && data.exposeName !== ''
      ? data.exposeName
      : entry.definitionKind === 'app'
        ? './app'
        : `./widgets/${entry.id}`

  return { containerName: data.containerName, exposeName }
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

      const { containerName, exposeName } = readAdapterData(entry)

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
          options.runtime.loadRemote(`${containerName}/${exposeName.replace(/^\.\//, '')}`),
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
                  'Check the browser network panel for the failed chunk; a shared-singleton version conflict reports itself separately.',
              },
        )
      }

      signal.throwIfAborted()

      const definition = extractDefinition(moduleExports, entry.id)

      if (definition.kind !== entry.definitionKind) {
        throw createMfeError({
          code: 'registry/invalid-descriptor',
          id: entry.id,
          operation: 'load definition',
          expected: `a ${entry.definitionKind} definition, as the registry advertises`,
          observed: `a ${definition.kind} definition`,
          repair: 'Rebuild the container so its descriptor matches what src/mfe.ts exports.',
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
