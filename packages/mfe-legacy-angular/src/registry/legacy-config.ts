/**
 * The legacy registry vocabulary and the adapter-private payload it becomes.
 *
 * Everything the previous shell registry knew about an app is described here
 * once, so the rest of the framework never has to name a legacy field. The
 * neutral record carries identity, manifest URL and presentation only; the
 * fields below travel in `adapterData`, where only this package reads them.
 *
 * The shapes are modelled on production-equivalent contract fixtures. The
 * legacy applications themselves are not part of this repository, so nothing
 * here is verified against them.
 */

import { createMfeError, type NeutralRegistryEntry } from '@company/mfe-core'

/**
 * One entry of the legacy shell registry, as the previous generation of
 * containers published it.
 *
 * `name` is the federation container name as well as the app's identity: the
 * loader registers the remote under it and loads `<name>/single-spa-app` from
 * it, so it is preserved verbatim in the adapter payload.
 */
export interface LegacyAppConfig {
  readonly name: string
  readonly title?: string
  readonly icon?: string
  readonly mfManifestUrl: string
  readonly onboardingType?: string
  readonly tags?: readonly string[]
  readonly categories?: readonly string[]
  readonly version?: string
  readonly externalUrl?: string
  readonly routes?: readonly string[]
  readonly settings?: {
    readonly routes?: readonly string[]
  }
  /**
   * The legacy catalog flag. Legacy entries that omit it are never hidden;
   * it is not a security boundary, exactly as in the neutral record.
   */
  readonly hidden?: boolean
}

/** Who writes the URL when a legacy app navigates. */
export type NavigationOwnership = 'shell' | 'app'

/**
 * The adapter-private payload attached to a translated entry.
 *
 * Array fields are always present (empty when the legacy entry omitted them) so
 * shell surfaces can iterate without repeating the same optional-chaining, and
 * genuinely optional single values stay optional.
 */
export interface LegacyAdapterData {
  /** The legacy `name`: federation container name and single-spa activity name. */
  readonly containerName: string
  /** The module the container exposes; the shell loads it through the loader. */
  readonly exposeName: './single-spa-app'
  /** Legacy apps do not own their URL. The shell routes them. */
  readonly navigationOwnership: NavigationOwnership
  readonly onboardingType?: string
  readonly tags: readonly string[]
  readonly categories: readonly string[]
  readonly externalUrl?: string
  readonly routes: readonly string[]
  /** The legacy `settings.routes`, flattened to one array. */
  readonly settingsRoutes: readonly string[]
}

/** The expose path every legacy container publishes its parcel under. */
export const LEGACY_PARCEL_EXPOSE_NAME = './single-spa-app'

/** Legacy apps are routed by the shell; new Apps route themselves. */
export const LEGACY_NAVIGATION_OWNERSHIP: NavigationOwnership = 'shell'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/**
 * Reads the adapter payload back in a typed way.
 *
 * Shell surfaces that still render legacy metadata — the catalog, the finder,
 * onboarding — call this instead of casting `adapterData`, so a translation
 * change is a compile error rather than a silent `undefined` on a tile.
 */
export function readLegacyAdapterData(entry: NeutralRegistryEntry): LegacyAdapterData {
  if (entry.adapter !== 'legacy-angular') {
    throw createMfeError({
      code: 'registry/invalid-descriptor',
      id: entry.id,
      operation: 'read legacy adapter data',
      expected: 'an entry claimed by the legacy adapter',
      observed: `an entry claimed by the ${entry.adapter} adapter`,
      declaredBy: 'The legacy adapter',
      repair:
        'Only read legacy adapter data for entries whose adapter is "legacy-angular". Check entry.adapter first.',
    })
  }

  const data = entry.adapterData

  if (!isRecord(data) || typeof data['containerName'] !== 'string') {
    throw createMfeError({
      code: 'registry/invalid-descriptor',
      id: entry.id,
      operation: 'read legacy adapter data',
      path: ['adapterData', 'containerName'],
      expected: 'the payload produced by the legacy adapter rule',
      observed: isRecord(data) ? 'a payload without a container name' : 'no payload',
      declaredBy: 'The legacy adapter',
      repair:
        'Build the entry with createLegacyAdapterRule().normalize rather than assembling a neutral record by hand.',
    })
  }

  return {
    containerName: data['containerName'],
    exposeName: LEGACY_PARCEL_EXPOSE_NAME,
    navigationOwnership: LEGACY_NAVIGATION_OWNERSHIP,
    ...(typeof data['onboardingType'] === 'string'
      ? { onboardingType: data['onboardingType'] }
      : {}),
    tags: isStringArray(data['tags']) ? data['tags'] : [],
    categories: isStringArray(data['categories']) ? data['categories'] : [],
    ...(typeof data['externalUrl'] === 'string' ? { externalUrl: data['externalUrl'] } : {}),
    routes: isStringArray(data['routes']) ? data['routes'] : [],
    settingsRoutes: isStringArray(data['settingsRoutes']) ? data['settingsRoutes'] : [],
  }
}
