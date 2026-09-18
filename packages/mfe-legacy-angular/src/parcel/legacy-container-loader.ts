/**
 * The container loader for legacy apps.
 *
 * It implements the host's loader port with the loading shape the shell
 * already uses, unchanged: register the remote under the legacy app name, load
 * `<name>/single-spa-app` from it, and hand back the parcel lifecycles for the
 * parcel mount to drive. Replacing this with the new App loader would change
 * how every legacy app boots, so it is deliberately preserved rather than
 * reimplemented.
 *
 * The federation runtime is injected, exactly as in the React adapter's loader,
 * so this module has no import-time side effects and tests need no runtime.
 */

import { createMfeError, toMfeError, type NeutralRegistryEntry } from '@company/mfe-core'
import type { ContainerLoader, LoadedDefinition } from '@company/mfe-host'

import {
  LEGACY_PARCEL_EXPOSE_NAME,
  readLegacyAdapterData,
  type NavigationOwnership,
} from '../registry/legacy-config.ts'
import {
  isLegacyParcelConfig,
  missingParcelLifecycles,
  type LegacyParcelConfig,
} from './single-spa-contract.ts'

/** The subset of the federation runtime this loader uses. */
export interface LegacyFederationRuntime {
  registerRemotes(
    remotes: readonly { name: string; entry: string }[],
    options?: { force?: boolean },
  ): void
  loadRemote<T>(id: string): Promise<T | null>
}

export interface LegacyContainerLoaderOptions {
  /**
   * The federation runtime. Injected so tests and local development never have
   * to load the real one, and so importing this file starts nothing.
   */
  readonly runtime: LegacyFederationRuntime
}

/** What a legacy container yields: the parcel lifecycles plus how to mount them. */
export interface LegacyParcelModule {
  readonly parcelConfig: LegacyParcelConfig
  /** The legacy name, needed again as the parcel's activity name. */
  readonly containerName: string
  /** Legacy apps do not own their URL; the shell routes them. */
  readonly navigationOwnership: NavigationOwnership
}

/**
 * A legacy container may export its lifecycles directly or behind `default`,
 * depending on how its build wrapped the single-spa Angular helper. Both are
 * accepted, because both exist in production and neither is worth a migration.
 */
function extractParcelConfig(
  moduleExports: unknown,
  entry: NeutralRegistryEntry,
  containerName: string,
): LegacyParcelConfig {
  if (isLegacyParcelConfig(moduleExports)) return moduleExports

  if (moduleExports !== null && typeof moduleExports === 'object') {
    const fromDefault = (moduleExports as { default?: unknown }).default
    if (isLegacyParcelConfig(fromDefault)) return fromDefault
  }

  const missing = missingParcelLifecycles(moduleExports)
  throw createMfeError({
    code: 'load/entry-failure',
    id: entry.id,
    operation: `load ${containerName}/${LEGACY_PARCEL_EXPOSE_NAME.replace(/^\.\//, '')}`,
    expected: 'a module exporting the single-spa lifecycles bootstrap, mount and unmount',
    observed:
      moduleExports === null || moduleExports === undefined
        ? 'nothing'
        : `a module missing ${missing.join(', ')}`,
    declaredBy: 'The legacy adapter',
    repair: `Check that ${containerName} still exposes "${LEGACY_PARCEL_EXPOSE_NAME}" from its federation config and that the exposed module returns the single-spa Angular lifecycles.`,
  })
}

/**
 * Creates the legacy loader.
 *
 * Registration is idempotent per container: the remote is registered the first
 * time one of its definitions is loaded, which is also why changing a
 * developer override needs a reload rather than a remount.
 */
export function createLegacyContainerLoader(
  options: LegacyContainerLoaderOptions,
): ContainerLoader<LegacyParcelModule> {
  const registered = new Set<string>()

  return {
    load: async (entry, { signal }): Promise<LoadedDefinition<LegacyParcelModule>> => {
      signal.throwIfAborted()

      const { containerName, navigationOwnership } = readLegacyAdapterData(entry)

      if (!registered.has(containerName)) {
        try {
          options.runtime.registerRemotes([{ name: containerName, entry: entry.manifestUrl }])
          registered.add(containerName)
        } catch (error) {
          throw toMfeError(error, {
            code: 'load/manifest-failure',
            id: entry.id,
            operation: 'register the legacy container',
            declaredBy: 'The federation runtime',
            repair: `Check that ${entry.manifestUrl} is reachable and serves the manifest ${containerName} publishes.`,
          })
        }
      }

      const remoteId = `${containerName}/${LEGACY_PARCEL_EXPOSE_NAME.replace(/^\.\//, '')}`

      let moduleExports: unknown
      try {
        moduleExports = await options.runtime.loadRemote(remoteId)
      } catch (error) {
        throw toMfeError(error, {
          code: 'load/entry-failure',
          id: entry.id,
          operation: `load ${remoteId}`,
          declaredBy: 'The federation runtime',
          repair:
            'Check the browser network panel for the failed chunk. The legacy expose path is unchanged by the migration, so a 404 here means the container was built without it.',
        })
      }

      signal.throwIfAborted()

      const parcelConfig = extractParcelConfig(moduleExports, entry, containerName)

      return {
        identity: {
          id: entry.id,
          kind: 'app',
          ...(entry.version === undefined ? {} : { version: entry.version }),
        },
        module: { parcelConfig, containerName, navigationOwnership },
      }
    },
  }
}
