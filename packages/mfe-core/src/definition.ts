/** Neutral definition records; the host's internal mount and scope tokens never appear here. */

import { createMfeError } from './errors.ts'

export type DefinitionKind = 'app' | 'widget'

/** App-only; a Widget cannot declare a capability. */
export const CAPABILITY_NAMES = ['settings', 'help', 'releaseNotes'] as const
export type CapabilityName = (typeof CAPABILITY_NAMES)[number]

export function isCapabilityName(value: unknown): value is CapabilityName {
  return typeof value === 'string' && (CAPABILITY_NAMES as readonly string[]).includes(value)
}

/** An icon name, never markup; `{ src }` renders in an `<img>` and never enters the shell DOM. */
export type CapabilityIconRef = string | { readonly src: string }

/**
 * What a route writes to publish itself as one of the App's capability pages. The build reads it
 * statically and adds the route's own path, so every field has to be written as a literal.
 */
export interface CapabilityDeclaration {
  readonly name: CapabilityName
  /** What the shell calls the page. */
  readonly label: string
  readonly icon?: CapabilityIconRef
}

export interface CapabilityDescriptor extends CapabilityDeclaration {
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

/**
 * What an icon may draw with. `IconData` arrives over the network from another origin, so every
 * reader of it — the build that first parses an import, and every host that later renders the
 * result — drops anything outside this allowlist rather than carrying it into a document.
 */
export const ICON_ELEMENT_TAGS = [
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'g',
] as const

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
  readonly framework?: string
  /**
   * The Module Federation share scopes a host registers the container with, `default` first and
   * then its framework's, such as `react@19.3.0`. Absent means a container built before
   * framework scopes, which shares in `default` alone.
   */
  readonly shareScopes?: readonly string[]
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
  /**
   * The same shape as `inputs`: an object schema with one property per declared event, in
   * declaration order, each the schema of that event's payload. A payload the build could not
   * read is `{}`; the whole field is absent when the event names themselves could not be read.
   */
  readonly events?: JsonSchemaObject
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

/** Every author-facing `createApp`/`createWidget` shares this check; `operation` names the call. */
export function assertDefinitionId(id: unknown, operation: string): asserts id is string {
  if (isValidDefinitionId(id)) return

  throw createMfeError({
    code: 'registry/invalid-entry',
    id: typeof id === 'string' && id !== '' ? id : '<missing>',
    operation,
    expected: DEFINITION_ID_RULE,
    observed:
      id === undefined ? 'nothing' : typeof id === 'string' ? JSON.stringify(id) : typeof id,
    repair: 'Give the definition a stable id; it is also its storage prefix and CSS scope value.',
  })
}
