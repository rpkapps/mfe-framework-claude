/**
 * The container loader for legacy apps, implementing the host's loader port
 * with the shell's existing loading shape unchanged: register the remote under
 * the legacy app name, load `<name>/single-spa-app`, hand back the lifecycles.
 * The federation runtime is injected, so importing this module starts nothing.
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

/** What a legacy container yields: the parcel lifecycles plus how to mount them. */
export interface LegacyParcelModule {
  readonly parcelConfig: LegacyParcelConfig
  /** The legacy name, needed again as the parcel's activity name. */
  readonly containerName: string
  readonly navigationOwnership: NavigationOwnership
}

const EXPOSE_PATH = LEGACY_PARCEL_EXPOSE_NAME.replace(/^\.\//, '')

/**
 * A legacy container may export its lifecycles directly or behind `default`,
 * depending on how its build wrapped the single-spa Angular helper. Both exist
 * in production and neither is worth a migration.
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

  throw createMfeError({
    code: 'load/entry-failure',
    id: entry.id,
    operation: `load ${containerName}/${EXPOSE_PATH}`,
    expected: 'a module exporting the single-spa lifecycles bootstrap, mount and unmount',
    observed:
      moduleExports === null || moduleExports === undefined
        ? 'nothing'
        : `a module missing ${missingParcelLifecycles(moduleExports).join(', ')}`,
    declaredBy: 'The legacy adapter',
    repair: `Check that ${containerName} still exposes "${LEGACY_PARCEL_EXPOSE_NAME}" from its federation config.`,
  })
}

/**
 * Registration is idempotent per container, which is also why changing a
 * developer override needs a reload rather than a remount.
 */
export function createLegacyContainerLoader(options: {
  readonly runtime: LegacyFederationRuntime
}): ContainerLoader<LegacyParcelModule> {
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

      const remoteId = `${containerName}/${EXPOSE_PATH}`

      let moduleExports: unknown
      try {
        moduleExports = await options.runtime.loadRemote(remoteId)
      } catch (error) {
        throw toMfeError(error, {
          code: 'load/entry-failure',
          id: entry.id,
          operation: `load ${remoteId}`,
          declaredBy: 'The federation runtime',
          // The expose path is unchanged by the migration, so a 404 here means
          // the container was built without it.
          repair: 'Check the browser network panel for the failed chunk.',
        })
      }

      signal.throwIfAborted()

      return {
        identity: {
          id: entry.id,
          kind: 'app',
          ...(entry.version === undefined ? {} : { version: entry.version }),
        },
        module: {
          parcelConfig: extractParcelConfig(moduleExports, entry, containerName),
          containerName,
          navigationOwnership,
        },
      }
    },
  }
}
