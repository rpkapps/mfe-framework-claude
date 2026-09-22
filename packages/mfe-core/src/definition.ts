/** Neutral definition records; the host's internal mount and scope tokens never appear here. */

export type DefinitionKind = 'app' | 'widget'

/** App-only; a Widget cannot declare a capability. */
export const CAPABILITY_NAMES = ['settings', 'help', 'releaseNotes'] as const
export type CapabilityName = (typeof CAPABILITY_NAMES)[number]

export function isCapabilityName(value: unknown): value is CapabilityName {
  return typeof value === 'string' && (CAPABILITY_NAMES as readonly string[]).includes(value)
}

/** An icon name, never markup; `{ src }` renders in an `<img>` and never enters the shell DOM. */
export type CapabilityIconRef = string | { readonly src: string }

export interface CapabilityDescriptor {
  readonly name: CapabilityName
  readonly label: string
  readonly icon?: CapabilityIconRef
  /** The App-relative route path the shell navigates to when opening it. */
  readonly path: string
}

/** Never gates loading: a container that names no build still mounts (§29). */
export interface BuildProvenance {
  readonly hash?: string
  readonly time?: string
}

/**
 * A parsed icon, carried as data because the registry crosses an origin boundary and must never
 * hold markup. The build reads it from whatever the author imported — an icon module's node
 * array, or an `.svg` file — and both forms arrive here identical.
 */
export interface IconData {
  /** Verbatim from an `.svg`; synthesised from an icon module's declared size. */
  readonly viewBox: string
  /** Presentation attributes for the root `<svg>`; an allowlist, so a filled icon stays filled. */
  readonly attributes?: Readonly<Record<string, string>>
  readonly node: readonly IconNode[]
}

/** One element of a parsed icon: `['path', { d: '…' }]`. */
export type IconNode = readonly [
  tag: string,
  attributes: Readonly<Record<string, string>>,
  children?: readonly IconNode[],
]

export interface DefinitionIdentity {
  readonly id: string
  readonly kind: DefinitionKind
  /** Optional; never gates loading, adapter selection or mounting. */
  readonly version?: string
}

export interface ContainerDescriptor {
  readonly manifestUrl: string
  /** The Module Federation container name; a shell registers the remote under it before fetching. */
  readonly container: string
  readonly contractMajor: number
  /** The adapter that built it; absent means a React container built before this field existed. */
  readonly framework?: 'react' | 'angular'
  readonly definitions: readonly ExportedDefinitionDescriptor[]
  /** Definition id to the generated expose path. */
  readonly entries: Readonly<Record<string, string>>
  readonly build?: BuildProvenance
}

export interface ExportedDefinitionDescriptor extends DefinitionIdentity {
  /** App-only; extracted statically from routes marked with `staticData`. */
  readonly capabilities?: readonly CapabilityDescriptor[]
  /** Widget-only; read statically at build time (§16). */
  readonly contract?: PublishedWidgetContract
  /** Presentation the author declares, so a host can catalogue the definition unloaded (§16). */
  readonly title?: string
  readonly description?: string
  readonly tags?: readonly string[]
  /** Resolved from the imported identifier at build time; never a component, never markup. */
  readonly icon?: IconData
}

/** What a host may know about a Widget without loading its container (§16). */
export interface PublishedWidgetContract {
  /** JSON Schema (draft 2020-12), absent when the build could not read the schema statically. */
  readonly inputs?: JsonSchemaObject
  /** Declared event names, in declaration order. */
  readonly events: readonly string[]
}

/** The subset of JSON Schema the build emits: values only, no `$ref`. */
export interface JsonSchemaObject {
  readonly [key: string]: JsonSchemaValue
}

export type JsonSchemaValue =
  string | number | boolean | null | readonly JsonSchemaValue[] | JsonSchemaObject

/** The id is also a storage prefix and a CSS scope value, so the character set stays unambiguous. */
const DEFINITION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidDefinitionId(value: unknown): value is string {
  return typeof value === 'string' && DEFINITION_ID_PATTERN.test(value)
}

export const DEFINITION_ID_RULE =
  'lower-case letters, digits and single hyphens (for example "alert-panel")'
