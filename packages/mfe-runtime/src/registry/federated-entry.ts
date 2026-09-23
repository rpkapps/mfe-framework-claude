/**
 * Reading an entry a federation build published. Every framework build publishes the same shape,
 * so it is checked once, here, and each adapter keeps only what differs between them: which
 * entries are its own, which its `detect` decides, and the `adapter` it stamps on what it parses.
 */

import {
  CAPABILITY_NAMES,
  createMfeError,
  FRAMEWORK_CONTRACT_MAJOR,
  isRecord,
  isSupportedContractMajor,
  withoutUndefined,
  type BuildProvenance,
  type CapabilityDescriptor,
  type IconData,
  type IconNode,
  type JsonSchemaObject,
  type MfeAdapter,
  type MfeError,
  type PublishedWidgetContract,
  type RegistryEntry,
} from '@company/mfe-core'
import { z } from 'zod'

import type { FederatedRegistryEntry } from '../loader/federation-loader.ts'

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
  .transform((value): IconData => withoutUndefined(value))

/** A string is a short text mark the host draws itself; an icon a host cannot read is no icon. */
const icon = z.union([z.string(), iconData, z.unknown().transform(() => undefined)])

/** Tags a host cannot read are no tags: a catalogue filter is not worth rejecting an entry over. */
const tags = z.unknown().transform(value => {
  const readable = Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string' && tag !== '')
    : []
  return readable.length === 0 ? undefined : readable
})

/**
 * Carried rather than checked, so a container that publishes a malformed `build` still loads.
 * A hash that is not a string is dropped rather than passed on, because it would reach a bug
 * report as `[object Object]` and be believed.
 */
const build = z.unknown().transform((value): BuildProvenance | undefined => {
  if (!isRecord(value)) return undefined
  const hash = value['hash']
  const time = value['time']
  if (typeof hash !== 'string' && typeof time !== 'string') return undefined
  return withoutUndefined({
    hash: typeof hash === 'string' ? hash : undefined,
    time: typeof time === 'string' ? time : undefined,
  })
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
  .transform((value): CapabilityDescriptor =>
    withoutUndefined({
      name: value.name,
      label: value.label,
      path: value.path,
      icon: value.icon,
    }),
  )

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
  .transform((value): PublishedWidgetContract =>
    withoutUndefined({
      events: value.events,
      inputs: value.inputs,
    }),
  )

/**
 * The framework version the container was built for. Which adapter the entry is for sits beside
 * it, and is each adapter's `detect` to read, not this schema's.
 */
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
    shareScopes: z
      .array(nonEmptyString('a non-empty share scope name'), {
        error: 'an array of share scope names, such as ["default", "react@19.3.0"]',
      })
      .optional(),
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
    repair: 'Rebuild the container; the registry entry is generated, never hand-written.',
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

/**
 * Strict: throws an `MfeError` coded `registry/invalid-entry` naming the field that broke, or
 * `contract/unsupported-major` for an entry built against a framework major this runtime cannot
 * load. What it returns carries `adapter`, so the caller's `is()` guard recognises it.
 */
export function parseFederatedEntry<K extends string>(
  raw: unknown,
  adapter: K,
): FederatedRegistryEntry & { readonly adapter: K } {
  const id = isRecord(raw) && typeof raw['id'] === 'string' ? raw['id'] : '<unknown>'

  gateContractMajor(id, raw)

  const result = entrySchema.safeParse(raw)
  if (!result.success) throw invalidEntry(id, result.error)

  const parsed = result.data

  // `adapter` is assigned outside `withoutUndefined`: it is typed by the caller's own generic
  // `K`, and a mapped type cannot decide whether a still-generic field's type includes `undefined`.
  return {
    adapter,
    ...withoutUndefined({
      id: parsed.id,
      definitionKind: parsed.kind,
      manifestUrl: parsed.manifestUrl,
      container: parsed.container,
      expose: parsed.expose,
      shareScopes: parsed.shareScopes,
      version: parsed.version,
      capabilities: parsed.capabilities,
      contract: parsed.contract,
      build: parsed.build,
      hidden: parsed.hidden === true ? true : undefined,
      title: parsed.title,
      description: parsed.description,
      tags: parsed.tags,
      icon: parsed.icon,
    }),
  }
}

export interface FederatedAdapterOptions<K extends string> {
  /** What `entry.adapter` says on everything the adapter parses, and what `mfe.framework` names. */
  readonly kind: K
  /**
   * Also claims an entry whose `mfe` marker names no framework, or is too broken to name one: a
   * build from before the field existed. At most one adapter on a page may claim them.
   */
  readonly claimsUnmarked?: boolean
  /** See `MfeAdapter.aroundLoad`. */
  readonly aroundLoad?: MfeAdapter['aroundLoad']
}

/**
 * The adapter for one framework's federation builds. The `mfe` marker is what `detect` reads,
 * however broken the rest of the entry is, so a broken entry fails in its own adapter's `parse`
 * rather than being read by another adapter, which would change how an application loads
 * unnoticed.
 */
export function createFederatedAdapter<K extends string>(
  options: FederatedAdapterOptions<K>,
): MfeAdapter<K, FederatedRegistryEntry & { readonly adapter: K }> {
  const { kind, claimsUnmarked = false, aroundLoad } = options

  const namesThisFramework = (marker: unknown): boolean => {
    if (!isRecord(marker)) return claimsUnmarked
    const framework = marker['framework']
    return framework === kind || (claimsUnmarked && framework === undefined)
  }

  return {
    kind,
    detect: raw => isRecord(raw) && 'mfe' in raw && namesThisFramework(raw['mfe']),
    parse: raw => parseFederatedEntry(raw, kind),
    is: (entry: RegistryEntry): entry is FederatedRegistryEntry & { readonly adapter: K } =>
      entry.adapter === kind,
    ...withoutUndefined({ aroundLoad }),
  }
}
