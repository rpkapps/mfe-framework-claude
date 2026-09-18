/**
 * The selection rule for entries published by the previous shell registry.
 *
 * It is the second rule in the selection table, and it only claims entries that
 * do not advertise the new framework contract at all. An entry that advertises
 * that contract belongs to the new adapter even when the advertisement is
 * malformed: reinterpreting a typo as legacy would change how an app loads
 * without anyone noticing, which is the one failure this ordering exists to
 * prevent.
 *
 * `advertises` therefore asks a question about the *source* only, never about
 * whether this adapter could cope; `normalize` is where translation is strict.
 */

import {
  createMfeError,
  DEFINITION_ID_RULE,
  isValidDefinitionId,
  type AdapterSelectionRule,
  type NeutralRegistryEntry,
} from '@company/mfe-core'

import {
  LEGACY_NAVIGATION_OWNERSHIP,
  LEGACY_PARCEL_EXPOSE_NAME,
  type LegacyAdapterData,
  type LegacyAppConfig,
} from './legacy-config.ts'

/** The key that marks an entry as advertising the new framework contract. */
const NEW_CONTRACT_KEY = 'mfe'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(
  id: string,
  details: Omit<Parameters<typeof createMfeError>[0], 'code' | 'id'>,
): never {
  throw createMfeError({ code: 'registry/invalid-descriptor', id, ...details })
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Derives the neutral definition id from the legacy `name`.
 *
 * Identity in the neutral registry is a lower-case, hyphen-separated slug,
 * because an id is also a storage prefix and a CSS scope value. Legacy names
 * are usually already in that shape; the ones that are not are converted
 * deterministically, so the same legacy entry always produces the same id.
 */
export function deriveLegacyDefinitionId(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function readStringArray(
  id: string,
  value: unknown,
  path: readonly (string | number)[],
): readonly string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    fail(id, {
      operation: 'translate legacy registry entry',
      path,
      expected: 'an array of strings, or nothing',
      observed: Array.isArray(value) ? 'an array containing a non-string' : typeof value,
      declaredBy: 'The legacy adapter',
      repair:
        'Correct the field in the shell registry entry. The legacy adapter translates it verbatim into the adapter payload.',
    })
  }
  return [...(value as readonly string[])]
}

function readOptionalString(
  id: string,
  value: unknown,
  path: readonly (string | number)[],
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    fail(id, {
      operation: 'translate legacy registry entry',
      path,
      expected: 'a string, or nothing',
      observed: typeof value,
      declaredBy: 'The legacy adapter',
      repair: 'Correct the field in the shell registry entry, or remove it.',
    })
  }
  return value
}

/**
 * True when the entry carries the minimum legacy metadata: an app name and the
 * manifest URL the loader needs. Presentation fields are optional, because the
 * old registry treated them as optional too and a missing icon must not remove
 * a working app from the shell.
 */
function hasRequiredLegacyMetadata(source: Record<string, unknown>): boolean {
  return isNonEmptyString(source['name']) && isNonEmptyString(source['mfManifestUrl'])
}

/**
 * Builds the legacy selection rule.
 *
 * Register it *after* the rule for the new contract. The normalizer walks the
 * table in order and the first rule that claims an entry owns it, including
 * when its translation then fails.
 */
export function createLegacyAdapterRule(): AdapterSelectionRule {
  return {
    adapter: 'legacy-angular',

    advertises: source => {
      if (!isRecord(source)) return false
      // An advertised new contract commits the entry to the new adapter, valid
      // or not. This rule never inspects how well-formed that advertisement is.
      if (NEW_CONTRACT_KEY in source) return false
      return hasRequiredLegacyMetadata(source)
    },

    normalize: source => {
      if (!isRecord(source)) {
        fail('<unknown>', {
          operation: 'translate legacy registry entry',
          expected: 'an object',
          observed: source === null ? 'null' : typeof source,
          declaredBy: 'The legacy adapter',
          repair: 'Publish the entry as an object in the shell registry.',
        })
      }

      const config = source as unknown as LegacyAppConfig
      const rawName = config.name
      const label = isNonEmptyString(rawName) ? rawName : '<unknown>'

      if (!isNonEmptyString(rawName)) {
        fail(label, {
          operation: 'translate legacy registry entry',
          path: ['name'],
          expected: 'a non-empty app name',
          observed: rawName === undefined ? 'nothing' : typeof rawName,
          declaredBy: 'The legacy adapter, which uses the name as the container name too',
          repair:
            'Set the app name in the shell registry entry. The loader registers the remote under it and loads its parcel from it.',
        })
      }

      const id = deriveLegacyDefinitionId(rawName)
      if (!isValidDefinitionId(id)) {
        fail(label, {
          operation: 'derive the definition id from the legacy app name',
          path: ['name'],
          expected: `a name that reduces to ${DEFINITION_ID_RULE}`,
          observed: JSON.stringify(rawName),
          declaredBy: 'The framework identity rules',
          repair:
            'Rename the app in the shell registry to a hyphenated lower-case name, for example "asset-tracker".',
        })
      }

      const manifestUrl = config.mfManifestUrl
      if (!isNonEmptyString(manifestUrl)) {
        fail(id, {
          operation: 'translate legacy registry entry',
          path: ['mfManifestUrl'],
          expected: 'a non-empty manifest URL',
          observed: manifestUrl === undefined ? 'nothing' : typeof manifestUrl,
          declaredBy: 'The legacy adapter',
          repair:
            'Point the entry at the container manifest the legacy build publishes, or set a developer override for local work.',
        })
      }

      const settings = source['settings']
      if (settings !== undefined && settings !== null && !isRecord(settings)) {
        fail(id, {
          operation: 'translate legacy registry entry',
          path: ['settings'],
          expected: 'an object such as { routes: [] }, or nothing',
          observed: typeof settings,
          declaredBy: 'The legacy adapter',
          repair: 'Correct the settings block in the shell registry entry, or remove it.',
        })
      }

      const onboardingType = readOptionalString(id, source['onboardingType'], ['onboardingType'])
      const externalUrl = readOptionalString(id, source['externalUrl'], ['externalUrl'])

      const adapterData: LegacyAdapterData = {
        containerName: rawName,
        exposeName: LEGACY_PARCEL_EXPOSE_NAME,
        navigationOwnership: LEGACY_NAVIGATION_OWNERSHIP,
        ...(onboardingType === undefined ? {} : { onboardingType }),
        tags: readStringArray(id, source['tags'], ['tags']),
        categories: readStringArray(id, source['categories'], ['categories']),
        ...(externalUrl === undefined ? {} : { externalUrl }),
        routes: readStringArray(id, source['routes'], ['routes']),
        settingsRoutes: readStringArray(id, isRecord(settings) ? settings['routes'] : undefined, [
          'settings',
          'routes',
        ]),
      }

      const title = readOptionalString(id, source['title'], ['title'])
      const icon = readOptionalString(id, source['icon'], ['icon'])
      const version = readOptionalString(id, source['version'], ['version'])

      return {
        id,
        definitionKind: 'app',
        adapter: 'legacy-angular',
        manifestUrl,
        adapterData,
        ...(version === undefined ? {} : { version }),
        ...(title === undefined ? {} : { title }),
        ...(icon === undefined ? {} : { icon }),
        ...(source['hidden'] === true ? { hidden: true } : {}),
      } satisfies NeutralRegistryEntry
    },
  }
}
