/**
 * The legacy registry vocabulary and the adapter-private payload it becomes: legacy fields
 * travel in `adapterData`, so the neutral record never names one. The shapes come from
 * contract fixtures (§9).
 */

import { createMfeError, type NeutralRegistryEntry } from '@company/mfe-core'

/** Who writes the URL when a legacy app navigates. */
export type NavigationOwnership = 'shell' | 'app'

/** Array fields are always present — empty when the entry omitted them — so callers need no chaining. */
export interface LegacyAdapterData {
  readonly containerName: string
  readonly exposeName: './single-spa-app'
  readonly navigationOwnership: NavigationOwnership
  readonly onboardingType?: string
  readonly tags: readonly string[]
  readonly categories: readonly string[]
  readonly externalUrl?: string
  readonly routes: readonly string[]
  readonly settingsRoutes: readonly string[]
}

/** The expose path every legacy container publishes its parcel under. */
export const LEGACY_PARCEL_EXPOSE_NAME = './single-spa-app'

/** Legacy apps are routed by the shell; new Apps route themselves. */
export const LEGACY_NAVIGATION_OWNERSHIP: NavigationOwnership = 'shell'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function failDescriptor(
  id: string,
  details: Omit<Parameters<typeof createMfeError>[0], 'code' | 'id'>,
): never {
  throw createMfeError({
    code: 'registry/invalid-descriptor',
    id,
    ...details,
  })
}

/** Typed read-back, so a translation change is a compile error rather than a silent `undefined` on a tile. */
export function readLegacyAdapterData(entry: NeutralRegistryEntry): LegacyAdapterData {
  if (entry.adapter !== 'legacy-angular') {
    failDescriptor(entry.id, {
      operation: 'read legacy adapter data',
      expected: 'an entry claimed by the legacy adapter',
      observed: `an entry claimed by the ${entry.adapter} adapter`,
      repair: 'Check entry.adapter is "legacy-angular" before reading legacy adapter data.',
    })
  }

  const data = entry.adapterData

  if (!isRecord(data) || typeof data['containerName'] !== 'string') {
    failDescriptor(entry.id, {
      operation: 'read legacy adapter data',
      path: ['adapterData', 'containerName'],
      expected: 'the payload produced by the legacy adapter rule',
      observed: isRecord(data) ? 'a payload without a container name' : 'no payload',
      repair: 'Build the entry with createLegacyAdapterRule().normalize.',
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
