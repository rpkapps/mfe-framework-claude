/**
 * The selection rule for entries that advertise the new framework contract.
 * `advertises` is deliberately loose and `normalize` strict, so a typo in new
 * metadata fails explicitly instead of being reinterpreted as another adapter.
 */

import {
  CAPABILITY_NAMES,
  createMfeError,
  FRAMEWORK_CONTRACT_MAJOR,
  isCapabilityName,
  isSupportedContractMajor,
  type AdapterSelectionRule,
  type BuildProvenance,
  type CapabilityDescriptor,
  type CapabilityIconRef,
  type IconData,
  type IconNode,
  type JsonSchemaObject,
  type NeutralRegistryEntry,
  type PublishedWidgetContract,
} from '@company/mfe-core'

/** The `mfe` property is the contract marker: its presence commits the entry here. */
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
  readonly description?: unknown
  readonly tags?: unknown
  readonly icon?: unknown
  readonly contract?: unknown
  readonly build?: unknown
}

/** Every descriptor failure has the same fix, so the sentence is written once. */
const REBUILD = 'Rebuild the container; the registry descriptor is generated, never hand-written.'

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
      repair: REBUILD,
    })
  }

  const major = mfe['contractMajor']
  if (typeof major !== 'number' || !Number.isInteger(major)) {
    fail(id, {
      operation: 'read the advertised framework contract major',
      expected: 'an integer',
      observed: major === undefined ? 'nothing' : typeof major,
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
      repair:
        major > FRAMEWORK_CONTRACT_MAJOR
          ? 'Upgrade the shell, or redeploy the container against the shell’s major.'
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
      repair: REBUILD,
    })
  }

  return value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail(id, {
        operation: `read capability at index ${index}`,
        expected: 'a capability descriptor object',
        observed: typeof candidate,
        repair: REBUILD,
      })
    }

    const name = candidate['name']
    if (!isCapabilityName(name)) {
      fail(id, {
        operation: `read capability at index ${index}`,
        expected: `one of ${CAPABILITY_NAMES.join(', ')}`,
        observed: typeof name === 'string' ? JSON.stringify(name) : typeof name,
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
        repair: 'Use a shell icon name, or { src: assetUrl } for a mark the set lacks.',
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
 * `inputs` is optional on purpose: a build that could not read the schema statically
 * publishes the event names alone, which must not collapse into the empty object a Widget
 * that genuinely takes nothing would publish.
 */
function readWidgetContract(id: string, value: unknown): PublishedWidgetContract | undefined {
  if (value === undefined) return undefined

  if (!isRecord(value)) {
    fail(id, {
      operation: 'read the published Widget contract',
      expected: 'an object with the declared event names and, when readable, an inputs schema',
      observed: typeof value,
      repair: 'Rebuild the container; the contract is generated, never hand-written.',
    })
  }

  const events = value['events']
  if (!Array.isArray(events) || events.some(name => typeof name !== 'string')) {
    fail(id, {
      operation: 'read the published Widget contract events',
      expected: 'an array of event names',
      observed: Array.isArray(events) ? 'an array holding something else' : typeof events,
      repair: REBUILD,
    })
  }

  const inputs = value['inputs']
  if (inputs !== undefined && !isRecord(inputs)) {
    fail(id, {
      operation: 'read the published Widget input schema',
      expected: 'a JSON Schema object, or nothing when the build could not read one',
      observed: typeof inputs,
      repair: REBUILD,
    })
  }

  return {
    events: events as readonly string[],
    ...(inputs === undefined ? {} : { inputs: inputs as JsonSchemaObject }),
  }
}

/**
 * Carried rather than checked, so a container that publishes a malformed `build` still
 * loads; the field is dropped rather than passed on, because a hash that is not a string
 * would reach a bug report as `[object Object]` and be believed (§29).
 */
/** Tags a host cannot read are no tags: a catalogue filter is not worth quarantining an entry over. */
function readTags(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const tags = value.filter((tag): tag is string => typeof tag === 'string' && tag !== '')
  return tags.length === 0 ? undefined : tags
}

/**
 * A string is a short text mark the host draws itself. Anything else has to be a parsed icon,
 * checked shape by shape: this record arrived over the network from another origin, and the
 * renderer is handed it directly.
 */
function readIcon(value: unknown): string | IconData | undefined {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined

  const viewBox = value['viewBox']
  const node = readIconNodes(value['node'])
  if (typeof viewBox !== 'string' || viewBox === '' || node === undefined) return undefined

  const attributes = readIconAttributes(value['attributes'])

  return {
    viewBox,
    ...(attributes === undefined ? {} : { attributes }),
    node,
  }
}

function readIconNodes(value: unknown): readonly IconNode[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined

  const nodes: IconNode[] = []
  for (const element of value) {
    if (!Array.isArray(element)) return undefined
    const [tag, attributes, children] = element as readonly unknown[]
    if (typeof tag !== 'string' || tag === '') return undefined

    const readAttributes = readIconAttributes(attributes) ?? {}
    if (children === undefined) {
      nodes.push([tag, readAttributes])
      continue
    }

    const readChildren = readIconNodes(children)
    if (readChildren === undefined) return undefined
    nodes.push([tag, readAttributes, readChildren])
  }

  return nodes
}

function readIconAttributes(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined

  const attributes: Record<string, string> = {}
  for (const [name, attribute] of Object.entries(value)) {
    if (typeof attribute === 'string') attributes[name] = attribute
  }
  return Object.keys(attributes).length === 0 ? undefined : attributes
}

function readBuildProvenance(value: unknown): BuildProvenance | undefined {
  if (!isRecord(value)) return undefined

  const hash = value['hash']
  const time = value['time']
  if (typeof hash !== 'string' && typeof time !== 'string') return undefined

  return {
    ...(typeof hash === 'string' ? { hash } : {}),
    ...(typeof time === 'string' ? { time } : {}),
  }
}

/** The adapter kind is a parameter, so a second authoring adapter is a table entry. */
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
          repair: 'Set a stable id on the createApp/createWidget call and rebuild.',
        })
      }

      if (typeof entry.manifestUrl !== 'string' || entry.manifestUrl === '') {
        fail(id, {
          operation: 'read manifest URL',
          expected: 'a non-empty URL string',
          observed: entry.manifestUrl === undefined ? 'nothing' : typeof entry.manifestUrl,
          repair: 'Point the entry at the container’s mf-manifest.json, or set a dev override.',
        })
      }

      if (entry.kind !== 'app' && entry.kind !== 'widget') {
        fail(id, {
          operation: 'read definition kind',
          expected: '"app" or "widget"',
          observed: typeof entry.kind === 'string' ? JSON.stringify(entry.kind) : typeof entry.kind,
          repair: 'Rebuild the container; the kind is derived from createApp/createWidget.',
        })
      }

      const contract = readWidgetContract(id, entry.contract)
      if (contract && entry.kind === 'app') {
        fail(id, {
          operation: 'read the published Widget contract',
          expected: 'no Widget contract on an App',
          observed: 'an inputs/events contract',
          repair:
            'An App has no inputs and no events. Drop the contract, or declare the surface as a Widget.',
        })
      }

      const build = readBuildProvenance(entry.build)
      const tags = readTags(entry.tags)
      const icon = readIcon(entry.icon)

      const capabilities = readCapabilities(id, entry.capabilities)
      if (capabilities && entry.kind === 'widget') {
        fail(id, {
          operation: 'read advertised capabilities',
          expected: 'no capabilities on a Widget',
          observed: `${capabilities.length} capability descriptor(s)`,
          repair: 'Move the capability routes into an App, or drop them from the Widget.',
        })
      }

      // The federation container name and expose path are adapter-private, so they
      // travel in adapterData where only the owning adapter reads them.
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
        ...(contract ? { contract } : {}),
        ...(build ? { build } : {}),
        ...(entry.hidden === true ? { hidden: true } : {}),
        ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
        ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
        ...(tags ? { tags } : {}),
        ...(icon === undefined ? {} : { icon }),
      } satisfies NeutralRegistryEntry
    },
  }
}
