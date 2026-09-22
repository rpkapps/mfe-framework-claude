/**
 * The adapter for the registry entries the legacy Angular shell publishes. It recognises only
 * entries that carry no framework version at all, because reading a typo in a framework entry
 * as legacy would change how an app loads unnoticed (§9).
 */

import {
  createMfeError,
  DEFINITION_ID_RULE,
  isValidDefinitionId,
  type MfeAdapter,
  type MfeError,
  type RegistryEntry,
} from '@company/mfe-core'
import { z } from 'zod'

/** What `entry.adapter` says on everything this adapter parses. */
const LEGACY_ADAPTER_KIND = 'legacy-angular'

/** The key a framework build writes; its presence means the entry is not this adapter's. */
const FRAMEWORK_CONTRACT_KEY = 'mfe'

/** The expose path every legacy container publishes its parcel under. */
export const LEGACY_PARCEL_EXPOSE_NAME = './single-spa-app'

/** Who writes the URL when a legacy app navigates. */
export type NavigationOwnership = 'shell' | 'app'

/** Legacy apps are routed by the shell; framework Apps route themselves. */
export const LEGACY_NAVIGATION_OWNERSHIP: NavigationOwnership = 'shell'

/**
 * The legacy vocabulary, typed on this adapter's own entry and reached through
 * `legacyAngularAdapter.is(entry)`. The array fields are always present — empty when the entry
 * omitted them — so callers need no chaining.
 */
export interface LegacyRegistryEntry extends RegistryEntry {
  readonly adapter: typeof LEGACY_ADAPTER_KIND
  readonly containerName: string
  readonly exposeName: typeof LEGACY_PARCEL_EXPOSE_NAME
  readonly navigationOwnership: NavigationOwnership
  readonly onboardingType?: string
  readonly categories: readonly string[]
  readonly externalUrl?: string
  readonly routes: readonly string[]
  readonly settingsRoutes: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** An id is also a storage prefix and a CSS scope value, so a non-slug name is converted here. */
export function deriveLegacyDefinitionId(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** A list the shell registry omitted is an empty list, never a failure. */
const stringList = z
  .array(z.string({ error: 'an array of strings, or nothing' }), {
    error: 'an array of strings, or nothing',
  })
  .nullish()
  .transform(value => [...(value ?? [])])

const optionalText = z.string({ error: 'a string, or nothing' }).nullish()

const entrySchema = z
  .object({
    name: z
      .string({ error: 'a non-empty app name' })
      .refine(isNonEmptyString, { error: 'a non-empty app name' }),
    mfManifestUrl: z
      .string({ error: 'a non-empty manifest URL' })
      .refine(isNonEmptyString, { error: 'a non-empty manifest URL' }),
    title: optionalText,
    icon: optionalText,
    version: optionalText,
    onboardingType: optionalText,
    externalUrl: optionalText,
    hidden: z.unknown().optional(),
    tags: stringList,
    categories: stringList,
    routes: stringList,
    settings: z
      .object({ routes: stringList }, { error: 'an object such as { routes: [] }, or nothing' })
      .nullish(),
  })
  .loose()

/** The first issue is the one a reader acts on, so it is the one the error names. */
function invalidEntry(id: string, error: z.ZodError): MfeError {
  const issue = error.issues[0]
  const path = (issue?.path ?? []).filter(
    (segment): segment is string | number =>
      typeof segment === 'string' || typeof segment === 'number',
  )

  return createMfeError({
    code: 'registry/invalid-entry',
    id,
    operation: 'read legacy registry entry',
    ...(path.length === 0 ? {} : { path }),
    expected: issue?.message ?? 'a legacy registry entry',
    repair:
      path[0] === 'name'
        ? 'Set the app name in the shell registry entry. The loader registers the remote under it and loads its parcel from it.'
        : 'Correct the field in the shell registry entry, or remove it.',
  })
}

export const legacyAngularAdapter: MfeAdapter<typeof LEGACY_ADAPTER_KIND, LegacyRegistryEntry> = {
  kind: LEGACY_ADAPTER_KIND,

  detect: raw => {
    if (!isRecord(raw)) return false
    // A framework version, valid or not, means the entry belongs to a framework adapter.
    if (FRAMEWORK_CONTRACT_KEY in raw) return false
    // Presentation fields stay optional: a missing icon must not remove a working app.
    return isNonEmptyString(raw['name']) && isNonEmptyString(raw['mfManifestUrl'])
  },

  parse: raw => {
    const label = isRecord(raw) && isNonEmptyString(raw['name']) ? raw['name'] : '<unknown>'

    const result = entrySchema.safeParse(raw)
    if (!result.success) throw invalidEntry(label, result.error)

    const parsed = result.data
    const id = deriveLegacyDefinitionId(parsed.name)

    if (!isValidDefinitionId(id)) {
      throw createMfeError({
        code: 'registry/invalid-entry',
        id: label,
        operation: 'derive the definition id from the legacy app name',
        path: ['name'],
        expected: `a name that reduces to ${DEFINITION_ID_RULE}`,
        observed: JSON.stringify(parsed.name),
        repair: 'Rename the app to a hyphenated lower-case name, for example "asset-tracker".',
      })
    }

    return {
      id,
      definitionKind: 'app',
      adapter: LEGACY_ADAPTER_KIND,
      manifestUrl: parsed.mfManifestUrl,
      containerName: parsed.name,
      exposeName: LEGACY_PARCEL_EXPOSE_NAME,
      navigationOwnership: LEGACY_NAVIGATION_OWNERSHIP,
      ...(parsed.onboardingType == null ? {} : { onboardingType: parsed.onboardingType }),
      tags: parsed.tags,
      categories: parsed.categories,
      ...(parsed.externalUrl == null ? {} : { externalUrl: parsed.externalUrl }),
      routes: parsed.routes,
      settingsRoutes: parsed.settings?.routes ?? [],
      ...(parsed.version == null ? {} : { version: parsed.version }),
      ...(parsed.title == null ? {} : { title: parsed.title }),
      ...(parsed.icon == null ? {} : { icon: parsed.icon }),
      ...(parsed.hidden === true ? { hidden: true } : {}),
    }
  },

  is: (entry): entry is LegacyRegistryEntry => entry.adapter === LEGACY_ADAPTER_KIND,
}
