/**
 * The container loader for legacy apps: register the remote, load `<name>/single-spa-app`,
 * hand back the lifecycles. The federation runtime is injected, so importing starts nothing.
 */

import { createMfeError, toMfeError, type RegistryEntry } from '@company/mfe-core'
import type { ContainerLoader, LoadedDefinition } from '@company/mfe-host'

import {
  legacyAngularAdapter,
  LEGACY_PARCEL_EXPOSE_NAME,
  type NavigationOwnership,
} from '../registry/legacy-adapter.ts'
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

export interface LegacyParcelModule {
  readonly parcelConfig: LegacyParcelConfig
  /** The legacy name, needed again as the parcel's activity name. */
  readonly containerName: string
  readonly navigationOwnership: NavigationOwnership
}

const EXPOSE_PATH = LEGACY_PARCEL_EXPOSE_NAME.replace(/^\.\//, '')

/** A legacy container may export its lifecycles directly or behind `default`, depending on its build. */
function extractParcelConfig(
  moduleExports: unknown,
  entry: RegistryEntry,
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
    repair: `Check that ${containerName} still exposes "${LEGACY_PARCEL_EXPOSE_NAME}" from its federation config.`,
  })
}

/** Registration is idempotent per container, which is why a changed override needs a reload. */
export function createLegacyContainerLoader(options: {
  readonly runtime: LegacyFederationRuntime
}): ContainerLoader<LegacyParcelModule> {
  const registered = new Set<string>()

  return {
    load: async (entry, { signal }): Promise<LoadedDefinition<LegacyParcelModule>> => {
      signal.throwIfAborted()

      if (!legacyAngularAdapter.is(entry)) {
        throw createMfeError({
          code: 'registry/invalid-entry',
          id: entry.id,
          operation: 'load the legacy container',
          expected: 'an entry the legacy adapter parsed',
          observed: `an entry the ${entry.adapter} adapter parsed`,
          repair: 'Register legacyAngularAdapter so the shell reads legacy entries through it.',
        })
      }

      const { containerName, navigationOwnership } = entry

      if (!registered.has(containerName)) {
        try {
          options.runtime.registerRemotes([{ name: containerName, entry: entry.manifestUrl }])
          registered.add(containerName)
        } catch (error) {
          throw toMfeError(error, {
            code: 'load/manifest-failure',
            id: entry.id,
            operation: 'register the legacy container',
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
