/**
 * The Module Federation container loader: the one place in the framework that
 * knows federation exists. The neutral host orchestrates loading through a port
 * and this implements it, so nothing above this file sees a container name, an
 * expose path or a share scope. It lives in the React adapter because that is
 * the package that already depends on the singletons the share scope resolves.
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
  /**
   * Injected so tests and the in-process path never load the real runtime, and
   * so this module has no import-time side effects.
   */
  readonly runtime: FederationRuntime
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
      declaredBy: 'The build plugin, which emits the descriptor',
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
 * Hides `window.__TSR_ROUTER__` while a container's modules evaluate.
 *
 * TanStack's router constructor publishes every router it builds there, and
 * `@tanstack/router-plugin` injects a development HMR shim into each route
 * module that reads it back: finding a route already registered under its own
 * id, the module concludes it is a hot update of that route and copies the
 * live route's component onto itself.
 *
 * Both halves assume one router per page. A shell has one per mount, and every
 * App's root route is `__root__`, so a freshly loaded container recognised the
 * *shell's* root as its own previous self and adopted the shell's component —
 * which rendered the entire shell, recursively, inside the App that had just
 * mounted. Nothing in a unit test or a production build shows this: the shim
 * is emitted only in development.
 *
 * Removing the global for the duration of the load is enough, because the shim
 * does nothing when it finds no router. It is restored afterwards only if
 * nothing published a newer one in the meantime — that router is now the page's
 * most recent, and overwriting it would resurrect a stale reference.
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
 * Registration is idempotent per container: several definitions exported by one
 * container register it once, which is also why a developer override has to be
 * consistent across that container's exports.
 */
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
            declaredBy: 'The federation runtime',
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
        throw toMfeError(error, {
          code: 'load/entry-failure',
          id: entry.id,
          operation: 'load federation entry',
          declaredBy: 'The federation runtime',
          repair:
            'Check the browser network panel for the failed chunk; a shared-singleton version conflict reports itself separately.',
        })
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
          declaredBy: 'The shell registry',
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

/**
 * A container may export one App, one or more Widgets, or both, and a default
 * export is allowed when there is exactly one definition. The generated entry
 * narrows this to a single definition per expose path.
 */
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
        declaredBy: 'The framework definition contract',
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
    declaredBy: 'The framework definition contract',
    repair: 'Export the definition from src/mfe.ts and rebuild the container.',
  })
}
