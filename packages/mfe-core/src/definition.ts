/** Neutral definition records; the host's internal mount and scope tokens never appear here. */

export type DefinitionKind = 'app' | 'widget'

/** App-only; a Widget cannot advertise a capability. */
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
