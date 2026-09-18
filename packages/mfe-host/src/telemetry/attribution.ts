/**
 * Reserved attribution: the identity the host binds onto every telemetry record
 * it emits for a mount.
 *
 * An author attribute that collides with a reserved key loses, and the reserved
 * values are merged *after* the author attributes have been clamped, so a
 * caller cannot crowd attribution out by sending sixty-four of their own.
 */

import {
  boundAttributes,
  type TelemetryAttributes,
  type TelemetryAttribution,
} from '@company/mfe-core'

/**
 * The `mfe.*` namespace the host owns. Span ids live here too: they are written
 * by the tracer so a provider can rebuild parentage from a record alone, and an
 * author who set them by hand would silently corrupt the trace.
 */
export const RESERVED_ATTRIBUTE_KEYS = {
  definitionId: 'mfe.definition.id',
  definitionKind: 'mfe.definition.kind',
  definitionVersion: 'mfe.definition.version',
  buildHash: 'mfe.build.hash',
  mountToken: 'mfe.mount.token',
  traceId: 'mfe.trace.id',
  spanId: 'mfe.span.id',
  parentSpanId: 'mfe.span.parent_id',
  cancelled: 'mfe.span.cancelled',
  endReason: 'mfe.span.end_reason',
} as const

export type ReservedAttributeKey =
  (typeof RESERVED_ATTRIBUTE_KEYS)[keyof typeof RESERVED_ATTRIBUTE_KEYS]

const RESERVED_KEYS: ReadonlySet<string> = new Set<string>(Object.values(RESERVED_ATTRIBUTE_KEYS))

/** The attribution fields, paired with the attribute key each one renders as. */
const ATTRIBUTION_FIELDS = [
  ['definitionId', RESERVED_ATTRIBUTE_KEYS.definitionId],
  ['definitionKind', RESERVED_ATTRIBUTE_KEYS.definitionKind],
  ['definitionVersion', RESERVED_ATTRIBUTE_KEYS.definitionVersion],
  ['buildHash', RESERVED_ATTRIBUTE_KEYS.buildHash],
  ['mountToken', RESERVED_ATTRIBUTE_KEYS.mountToken],
] as const satisfies readonly (readonly [keyof TelemetryAttribution, string])[]

export function isReservedAttributeKey(key: string): boolean {
  return RESERVED_KEYS.has(key)
}

/**
 * Copies the supplied attribution fields into a frozen record and the matching
 * frozen attributes. Copying is what keeps records emitted before disposal
 * carrying exactly the attribution they were emitted with, even if the caller
 * mutates its own object afterwards.
 */
export function bindAttribution(source: TelemetryAttribution): {
  readonly attribution: TelemetryAttribution
  readonly attributes: TelemetryAttributes
} {
  const attribution: Record<string, string> = {}
  const attributes: Record<string, string> = {}
  for (const [field, key] of ATTRIBUTION_FIELDS) {
    const value = source[field]
    if (value === undefined) continue
    attribution[field] = value
    attributes[key] = value
  }
  return {
    attribution: Object.freeze(attribution) as unknown as TelemetryAttribution,
    attributes: Object.freeze(attributes),
  }
}

export interface MergedAttributes {
  readonly attributes: TelemetryAttributes
  /** Reserved keys the caller tried to set. Reported as a development diagnostic. */
  readonly collisions: readonly string[]
}

/**
 * Clamps the author attributes and then lets reserved attribution win.
 * Returns the reserved object itself when there is nothing to merge, so the
 * common attribute-free call allocates nothing.
 */
export function mergeWithReserved(
  author: TelemetryAttributes | undefined,
  reserved: TelemetryAttributes,
): MergedAttributes {
  const bounded = boundAttributes(author)
  const keys = Object.keys(bounded)
  if (keys.length === 0) return { attributes: reserved, collisions: [] }

  const collisions: string[] = []
  const authored: Record<string, string | number | boolean> = {}
  for (const key of keys) {
    if (RESERVED_KEYS.has(key)) {
      // The whole reserved namespace is host-owned, including the span ids the
      // tracer writes. A key the host does not bind on this record is dropped
      // rather than passed through, so a forged "mfe." attribute can never
      // reach a provider looking like attribution.
      collisions.push(key)
      continue
    }
    const value = bounded[key]
    if (value !== undefined) authored[key] = value
  }

  return { attributes: Object.freeze({ ...authored, ...reserved }), collisions }
}
