/**
 * The adapter for entries a React build publishes. `detect` is deliberately loose and `parse`
 * strict, so a typo in a React entry fails here instead of being read as some other kind of
 * container.
 */

import {
  CAPABILITY_NAMES,
  createMfeError,
  FRAMEWORK_CONTRACT_MAJOR,
  isSupportedContractMajor,
  type BuildProvenance,
  type CapabilityDescriptor,
  type IconData,
  type IconNode,
  type JsonSchemaObject,
  type MfeAdapter,
  type MfeError,
  type PublishedWidgetContract,
} from '@company/mfe-core'
import type { FederatedRegistryEntry } from '@company/mfe-runtime'
import { z } from 'zod'

/** What `entry.adapter` says on everything this adapter parses. */
const REACT_ADAPTER_KIND = 'react'

/**
 * The federation container name and expose path are typed on the entry and reached through
 * `reactAdapter.is(entry)`, never carried as an opaque payload; the federation loader reads the
 * same fields on every adapter's entries.
 */
export interface ReactRegistryEntry extends FederatedRegistryEntry {
  readonly adapter: typeof REACT_ADAPTER_KIND
}

/** Every failure here has the same fix, so the sentence is written once. */
const REBUILD = 'Rebuild the container; the registry entry is generated, never hand-written.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A message that reads as the expectation, because that is where the error puts it. */
function nonEmptyString(expected: string): z.ZodString {
  return z.string({ error: expected }).min(1, { error: expected })
}

const iconAttributes = z.record(
  z.string(),
  z.string({ error: 'an icon attribute value that is a string' }),
)

/**
 * Checked shape by shape, because this record arrived over the network from another origin and
 * the renderer is handed it directly.
 */
const iconNode: z.ZodType<IconNode> = z.lazy(() =>
  z.union([
    z.tuple([nonEmptyString('an element tag'), iconAttributes]),
    z.tuple([nonEmptyString('an element tag'), iconAttributes, z.array(iconNode)]),
  ]),
)

const iconData = z
  .object({
    viewBox: nonEmptyString('a viewBox'),
    attributes: iconAttributes.optional(),
    node: z.array(iconNode).min(1),
  })
  .transform((value): IconData => ({
    viewBox: value.viewBox,
    ...(value.attributes === undefined ? {} : { attributes: value.attributes }),
    node: value.node,
  }))

/** A string is a short text mark the host draws itself; an icon a host cannot read is no icon. */
const icon = z.union([z.string(), iconData, z.unknown().transform(() => undefined)])

/** Tags a host cannot read are no tags: a catalogue filter is not worth rejecting an entry over. */
const tags = z
  .unknown()
  .transform(value =>
    Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === 'string' && tag !== '')
      : [],
  )
  .transform(list => (list.length === 0 ? undefined : list))

/**
 * Carried rather than checked, so a container that publishes a malformed `build` still loads.
 * A hash that is not a string is dropped rather than passed on, because it would reach a bug
 * report as `[object Object]` and be believed (§29).
 */
const build = z.unknown().transform((value): BuildProvenance | undefined => {
  if (!isRecord(value)) return undefined
  const hash = value['hash']
  const time = value['time']
  if (typeof hash !== 'string' && typeof time !== 'string') return undefined
  return {
    ...(typeof hash === 'string' ? { hash } : {}),
    ...(typeof time === 'string' ? { time } : {}),
  }
})

const capability = z
  .object(
    {
      name: z.enum(CAPABILITY_NAMES, { error: `one of ${CAPABILITY_NAMES.join(', ')}` }),
      label: z.string({ error: 'a string label' }),
      path: z.string({ error: 'a string route path' }),
      icon: z
        .union([z.string(), z.object({ src: z.string() }).loose()], {
          error: 'an icon name from the shell icon set, or { src } for an asset URL',
        })
        .optional(),
    },
    { error: 'a capability object' },
  )
  .transform((value): CapabilityDescriptor => ({
    name: value.name,
    label: value.label,
    path: value.path,
    ...(value.icon === undefined ? {} : { icon: value.icon }),
  }))

/** The build emits values only, never a `$ref`, so the host carries the schema uninterpreted. */
const inputsSchema = z.custom<JsonSchemaObject>(isRecord, {
  error: 'a JSON Schema object, or nothing when the build could not read one',
})

/**
 * `inputs` is optional on purpose: a build that could not read the schema statically publishes
 * the event names alone, which must not collapse into the empty object a Widget that genuinely
 * takes nothing would publish.
 */
const publishedContract = z
  .object(
    {
      events: z.array(z.string({ error: 'an array of event names' }), {
        error: 'an array of event names',
      }),
      inputs: inputsSchema.optional(),
    },
    { error: 'an object with the declared event names and, when readable, an inputs schema' },
  )
  .transform((value): PublishedWidgetContract => ({
    events: value.events,
    ...(value.inputs === undefined ? {} : { inputs: value.inputs }),
  }))

/** The framework version the container was built for; its presence is what `detect` looks for. */
const contractMarker = z.object(
  { contractMajor: z.number({ error: 'an integer' }).int({ error: 'an integer' }) },
  { error: 'an object such as { "contractMajor": 1 }' },
)

const entrySchema = z
  .object({
    id: nonEmptyString('a non-empty definition id'),
    kind: z.union([z.literal('app'), z.literal('widget')], { error: '"app" or "widget"' }),
    mfe: contractMarker,
    manifestUrl: nonEmptyString('a non-empty URL string'),
    container: nonEmptyString('a non-empty federation container name'),
    expose: nonEmptyString('a non-empty expose path').optional(),
    version: z.string({ error: 'a version string' }).optional(),
    capabilities: z.array(capability, { error: 'an array of capability objects' }).optional(),
    contract: publishedContract.optional(),
    hidden: z.unknown().optional(),
    title: z.string({ error: 'a title string' }).optional(),
    description: z.string({ error: 'a description string' }).optional(),
    tags: tags.optional(),
    icon: icon.optional(),
    build: build.optional(),
  })
  .loose()
  // A Widget publishes what it takes and what it raises; an App has neither.
  .refine(value => !(value.contract !== undefined && value.kind === 'app'), {
    path: ['contract'],
    error:
      'no Widget contract on an App. An App has no inputs and no events. Drop the contract, or declare the surface as a Widget.',
  })
  // Capability routes are an App's own pages, so a Widget cannot own one.
  .refine(value => !(value.capabilities !== undefined && value.kind === 'widget'), {
    path: ['capabilities'],
    error:
      'no capabilities on a Widget. Move the capability routes into an App, or drop them from the Widget.',
  })

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
    operation: 'read registry entry',
    ...(path.length === 0 ? {} : { path }),
    expected: issue?.message ?? 'a valid registry entry',
    repair: REBUILD,
  })
}

/**
 * Gated before the shape, so an entry from a framework major the shell cannot load says exactly
 * that, rather than failing on whichever field that major renamed.
 */
function gateContractMajor(id: string, raw: unknown): void {
  if (!isRecord(raw)) return
  const marker = raw['mfe']
  if (!isRecord(marker)) return
  const major = marker['contractMajor']
  if (typeof major !== 'number' || !Number.isInteger(major)) return
  if (isSupportedContractMajor(major)) return

  throw createMfeError({
    code: 'contract/unsupported-major',
    id,
    operation: 'read the framework version the container was built for',
    expected: `contract major ${String(FRAMEWORK_CONTRACT_MAJOR)}`,
    observed: `contract major ${String(major)}`,
    repair:
      major > FRAMEWORK_CONTRACT_MAJOR
        ? 'Upgrade the shell, or redeploy the container against the shell’s major.'
        : 'Rebuild and redeploy the container against the current framework major.',
  })
}

/** An absent framework is a React build from before the field existed. */
function namesReact(marker: unknown): boolean {
  if (!isRecord(marker)) return true
  const framework = marker['framework']
  return framework === undefined || framework === REACT_ADAPTER_KIND
}

/**
 * Hides `window.__TSR_ROUTER__` while a React container's modules evaluate: the router plugin's
 * development HMR shim reads it back and, finding the shell's `__root__` registered under the
 * same id, copies the shell's component onto the App that just mounted. It is restored only if
 * nothing published a newer router meanwhile, which would resurrect a stale reference.
 */
async function withoutCurrentRouterGlobal<T>(load: () => Promise<T>): Promise<T> {
  const owner = globalThis as { __TSR_ROUTER__?: unknown }
  if (!('__TSR_ROUTER__' in owner)) return await load()

  const previous = owner.__TSR_ROUTER__
  delete owner.__TSR_ROUTER__

  try {
    return await load()
  } finally {
    if (!('__TSR_ROUTER__' in owner)) owner.__TSR_ROUTER__ = previous
  }
}

export const reactAdapter: MfeAdapter<typeof REACT_ADAPTER_KIND, ReactRegistryEntry> = {
  kind: REACT_ADAPTER_KIND,

  // The `mfe` key is the marker, valid or not: a broken framework entry must never fall to
  // another adapter, because that would change how an application loads unnoticed. Only an
  // entry that names another framework is someone else's, so one built before the field
  // existed, or with a marker too broken to name anything, is still read here and fails in
  // `parse`.
  detect: raw => isRecord(raw) && 'mfe' in raw && namesReact(raw['mfe']),

  parse: raw => {
    const id = isRecord(raw) && typeof raw['id'] === 'string' ? raw['id'] : '<unknown>'

    gateContractMajor(id, raw)

    const result = entrySchema.safeParse(raw)
    if (!result.success) throw invalidEntry(id, result.error)

    const parsed = result.data

    return {
      id: parsed.id,
      definitionKind: parsed.kind,
      adapter: REACT_ADAPTER_KIND,
      manifestUrl: parsed.manifestUrl,
      container: parsed.container,
      ...(parsed.expose === undefined ? {} : { expose: parsed.expose }),
      ...(parsed.version === undefined ? {} : { version: parsed.version }),
      ...(parsed.capabilities === undefined ? {} : { capabilities: parsed.capabilities }),
      ...(parsed.contract === undefined ? {} : { contract: parsed.contract }),
      ...(parsed.build === undefined ? {} : { build: parsed.build }),
      ...(parsed.hidden === true ? { hidden: true } : {}),
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      ...(parsed.description === undefined ? {} : { description: parsed.description }),
      ...(parsed.tags === undefined ? {} : { tags: parsed.tags }),
      ...(parsed.icon === undefined ? {} : { icon: parsed.icon }),
    }
  },

  is: (entry): entry is ReactRegistryEntry => entry.adapter === REACT_ADAPTER_KIND,

  // The runtime runs every React container's load inside this, and no other adapter's.
  aroundLoad: withoutCurrentRouterGlobal,
}
