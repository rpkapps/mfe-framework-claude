/**
 * Claims only entries that do not advertise the new contract at all, because reinterpreting
 * a typo in new metadata as legacy would change how an app loads unnoticed (§9).
 */

import {
  DEFINITION_ID_RULE,
  isValidDefinitionId,
  type AdapterSelectionRule,
  type NeutralRegistryEntry,
} from '@company/mfe-core'

import {
  failDescriptor as fail,
  isRecord,
  LEGACY_NAVIGATION_OWNERSHIP,
  LEGACY_PARCEL_EXPOSE_NAME,
  type LegacyAdapterData,
} from './legacy-config.ts'

/** The key that marks an entry as advertising the new framework contract. */
const NEW_CONTRACT_KEY = 'mfe'

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
      repair: 'Correct the field in the shell registry entry.',
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
      repair: 'Correct the field in the shell registry entry, or remove it.',
    })
  }
  return value
}

/** Register after the rule for the new contract: the first rule that claims an entry owns it. */
export function createLegacyAdapterRule(): AdapterSelectionRule {
  return {
    adapter: 'legacy-angular',

    advertises: source => {
      if (!isRecord(source)) return false
      // An advertised new contract commits the entry to the new adapter, valid or not.
      if (NEW_CONTRACT_KEY in source) return false
      // Presentation fields stay optional: a missing icon must not remove a
      // working app from the shell.
      return isNonEmptyString(source['name']) && isNonEmptyString(source['mfManifestUrl'])
    },

    normalize: source => {
      if (!isRecord(source)) {
        fail('<unknown>', {
          operation: 'translate legacy registry entry',
          expected: 'an object',
          observed: source === null ? 'null' : typeof source,
          repair: 'Publish the entry as an object in the shell registry.',
        })
      }

      const rawName = source['name']
      const label = isNonEmptyString(rawName) ? rawName : '<unknown>'

      if (!isNonEmptyString(rawName)) {
        fail(label, {
          operation: 'translate legacy registry entry',
          path: ['name'],
          expected: 'a non-empty app name',
          observed: rawName === undefined ? 'nothing' : typeof rawName,
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
          repair: 'Rename the app to a hyphenated lower-case name, for example "asset-tracker".',
        })
      }

      const manifestUrl = source['mfManifestUrl']
      if (!isNonEmptyString(manifestUrl)) {
        fail(id, {
          operation: 'translate legacy registry entry',
          path: ['mfManifestUrl'],
          expected: 'a non-empty manifest URL',
          observed: manifestUrl === undefined ? 'nothing' : typeof manifestUrl,
          repair: 'Point the entry at the container manifest the legacy build publishes.',
        })
      }

      const settings = source['settings']
      if (settings !== undefined && settings !== null && !isRecord(settings)) {
        fail(id, {
          operation: 'translate legacy registry entry',
          path: ['settings'],
          expected: 'an object such as { routes: [] }, or nothing',
          observed: typeof settings,
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
