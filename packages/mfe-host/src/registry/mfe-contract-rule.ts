/**
 * The selection rule for entries that advertise the new framework contract.
 *
 * `advertises` is deliberately loose — it only asks "did this entry claim the
 * new contract?" — while `normalize` is strict. That split is what makes a typo
 * in new metadata fail explicitly instead of silently changing loading
 * behaviour. A malformed advertised contract is never reinterpreted as another
 * adapter.
 */

import {
  CAPABILITY_NAMES,
  createMfeError,
  FRAMEWORK_CONTRACT_MAJOR,
  isCapabilityName,
  isSupportedContractMajor,
  type AdapterSelectionRule,
  type CapabilityDescriptor,
  type CapabilityIconRef,
  type NeutralRegistryEntry,
} from '@company/mfe-core'

/**
 * The shape a generated shell registry descriptor has. The `mfe`
 * property is the contract marker: its presence commits the entry to this
 * adapter for the rest of selection.
 */
interface AdvertisedEntry {
  readonly id?: unknown
  readonly mfe?: unknown
  readonly manifestUrl?: unknown
  readonly container?: unknown
  readonly expose?: unknown
  readonly kind?: unknown
  readonly version?: unknown
  readonly capabilities?: unknown
  readonly hidden?: unknown
  readonly title?: unknown
  readonly icon?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(
  id: string,
  details: Omit<Parameters<typeof createMfeError>[0], 'code' | 'id'>,
): never {
  throw createMfeError({ code: 'registry/invalid-descriptor', id, ...details })
}

function readContractMajor(id: string, mfe: unknown): number {
  if (!isRecord(mfe)) {
    fail(id, {
      operation: 'read the advertised framework contract',
      expected: 'an object such as { "contractMajor": 1 }',
      observed: mfe === undefined ? 'nothing' : typeof mfe,
      declaredBy: 'The framework registry contract',
      repair: 'Publish the registry descriptor emitted by the build rather than hand-writing it.',
    })
  }

  const major = mfe['contractMajor']
  if (typeof major !== 'number' || !Number.isInteger(major)) {
    fail(id, {
      operation: 'read the advertised framework contract major',
      expected: 'an integer',
      observed: major === undefined ? 'nothing' : typeof major,
      declaredBy: 'The framework registry contract',
      repair: `Rebuild the container with a framework release that emits contractMajor ${FRAMEWORK_CONTRACT_MAJOR}.`,
    })
  }

  if (!isSupportedContractMajor(major)) {
    throw createMfeError({
      code: 'contract/unsupported-major',
      id,
      operation: 'gate the advertised framework contract major',
      expected: `contract major ${FRAMEWORK_CONTRACT_MAJOR}`,
      observed: `contract major ${major}`,
      declaredBy: 'The host framework contract gate',
      repair:
        major > FRAMEWORK_CONTRACT_MAJOR
          ? 'Upgrade the shell to a framework release that supports this container, or redeploy the container against the shell’s major.'
          : 'Rebuild and redeploy the container against the current framework major.',
    })
  }

  return major
}

function readCapabilities(id: string, value: unknown): readonly CapabilityDescriptor[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    fail(id, {
      operation: 'read advertised capabilities',
      expected: 'an array of capability descriptors',
      observed: typeof value,
      declaredBy: 'The build plugin, which extracts routes marked with staticData.capability',
      repair: 'Rebuild the container; capability metadata is generated, never hand-written.',
    })
  }

  return value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail(id, {
        operation: `read capability at index ${index}`,
        expected: 'a capability descriptor object',
        observed: typeof candidate,
        declaredBy: 'The build plugin',
        repair: 'Rebuild the container.',
      })
    }

    const name = candidate['name']
    if (!isCapabilityName(name)) {
      fail(id, {
        operation: `read capability at index ${index}`,
        expected: `one of ${CAPABILITY_NAMES.join(', ')}`,
        observed: typeof name === 'string' ? JSON.stringify(name) : typeof name,
        declaredBy: 'The framework capability contract: capabilities are App-only and closed',
        repair: 'Correct the staticData.capability value on the route and rebuild.',
      })
    }

    const label = candidate['label']
    const path = candidate['path']
    if (typeof label !== 'string' || typeof path !== 'string') {
      fail(id, {
        operation: `read capability "${name}"`,
        expected: 'a string label and a string route path',
        observed: `label ${typeof label}, path ${typeof path}`,
        declaredBy: 'The build plugin',
        repair: 'Add staticData.label to the marked route and rebuild.',
      })
    }

    const icon = candidate['icon']
    if (
      icon !== undefined &&
      typeof icon !== 'string' &&
      !(isRecord(icon) && typeof icon['src'] === 'string')
    ) {
      fail(id, {
        operation: `read capability "${name}" icon`,
        expected: 'an icon name from the shell icon set, or { src } for an asset URL',
        observed: typeof icon,
        declaredBy: 'The capability icon contract: metadata carries a name, never SVG markup',
        repair:
          'Use a shell icon name, or supply { src: assetUrl } for a mark the shell set lacks.',
      })
    }

    return {
      name,
      label,
      path,
      ...(icon === undefined ? {} : { icon: icon as CapabilityIconRef }),
    } satisfies CapabilityDescriptor
  })
}

/**
 * Builds the selection rule for the new framework contract. The adapter kind is
 * a parameter so a future non-React authoring adapter is a second table entry
 * rather than a change here.
 */
export function createMfeContractRule(adapter: 'react' = 'react'): AdapterSelectionRule {
  return {
    adapter,

    advertises: source => isRecord(source) && 'mfe' in source,

    normalize: source => {
      if (!isRecord(source)) {
        fail('<unknown>', {
          operation: 'read registry entry',
          expected: 'an object',
          observed: typeof source,
          declaredBy: 'The shell registry',
          repair: 'Publish the generated registry descriptor.',
        })
      }

      const entry = source as AdvertisedEntry
      const id = typeof entry.id === 'string' ? entry.id : '<unknown>'

      readContractMajor(id, entry.mfe)

      if (typeof entry.id !== 'string' || entry.id === '') {
        fail(id, {
          operation: 'read definition id',
          expected: 'a non-empty string',
          observed: entry.id === undefined ? 'nothing' : typeof entry.id,
          declaredBy: 'The framework identity rules: the only public identity field is id',
          repair: 'Set a stable id on the createApp/createWidget call and rebuild.',
        })
      }

      if (typeof entry.manifestUrl !== 'string' || entry.manifestUrl === '') {
        fail(id, {
          operation: 'read manifest URL',
          expected: 'a non-empty URL string',
          observed: entry.manifestUrl === undefined ? 'nothing' : typeof entry.manifestUrl,
          declaredBy: 'The framework registry contract',
          repair:
            'Point the entry at the container’s mf-manifest.json, or set a localStorage override for local development.',
        })
      }

      if (entry.kind !== 'app' && entry.kind !== 'widget') {
        fail(id, {
          operation: 'read definition kind',
          expected: '"app" or "widget"',
          observed: typeof entry.kind === 'string' ? JSON.stringify(entry.kind) : typeof entry.kind,
          declaredBy: 'The framework definition contract',
          repair: 'Rebuild the container; the kind is derived from createApp/createWidget.',
        })
      }

      const capabilities = readCapabilities(id, entry.capabilities)
      if (capabilities && entry.kind === 'widget') {
        fail(id, {
          operation: 'read advertised capabilities',
          expected: 'no capabilities on a Widget',
          observed: `${capabilities.length} capability descriptor(s)`,
          declaredBy:
            'The ownership rules: settings, help and release notes are App capabilities only',
          repair: 'Move the capability routes into an App, or drop them from the Widget.',
        })
      }

      // The federation container name and expose path are adapter-private:
      // they are implementation details the neutral record must not name, so
      // they travel in adapterData where only the owning adapter reads them.
      const adapterData =
        typeof entry.container === 'string'
          ? {
              containerName: entry.container,
              exposeName:
                typeof entry.expose === 'string'
                  ? entry.expose
                  : entry.kind === 'app'
                    ? './app'
                    : `./widgets/${String(entry.id)}`,
            }
          : undefined

      return {
        id: entry.id,
        definitionKind: entry.kind,
        adapter,
        manifestUrl: entry.manifestUrl,
        ...(adapterData ? { adapterData } : {}),
        ...(typeof entry.version === 'string' ? { version: entry.version } : {}),
        ...(capabilities ? { capabilities } : {}),
        ...(entry.hidden === true ? { hidden: true } : {}),
        ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
        ...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
      } satisfies NeutralRegistryEntry
    },
  }
}
