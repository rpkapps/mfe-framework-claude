/**
 * Reserved attribution: the identity the host binds onto every telemetry record
 * it emits for a mount.
 *
 * Authors pass their own attributes, but the definition id, kind, version,
 * build hash and the internal mount token are bound by the host and cannot be
 * overridden: an author attribute that collides with a reserved key loses. The
 * reserved values are merged *after* the author attributes have been clamped to
 * the documented limits, so a caller cannot crowd attribution out of a record by
 * sending sixty-four attributes of their own.
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

export function isReservedAttributeKey(key: string): boolean {
  return RESERVED_KEYS.has(key)
}

/**
 * Copies the attribution into a frozen record with only the fields that were
 * actually supplied, so records emitted before disposal keep exactly the
 * attribution they were emitted with even if the caller mutates its own object.
 */
export function freezeAttribution(attribution: TelemetryAttribution): TelemetryAttribution {
  return Object.freeze({
    definitionId: attribution.definitionId,
    definitionKind: attribution.definitionKind,
    ...(attribution.definitionVersion === undefined
      ? {}
      : { definitionVersion: attribution.definitionVersion }),
    ...(attribution.buildHash === undefined ? {} : { buildHash: attribution.buildHash }),
    ...(attribution.mountToken === undefined ? {} : { mountToken: attribution.mountToken }),
  })
}

/** The attribution rendered as the attributes every record carries. */
export function reservedAttributesFor(attribution: TelemetryAttribution): TelemetryAttributes {
  return Object.freeze({
    [RESERVED_ATTRIBUTE_KEYS.definitionId]: attribution.definitionId,
    [RESERVED_ATTRIBUTE_KEYS.definitionKind]: attribution.definitionKind,
    ...(attribution.definitionVersion === undefined
      ? {}
      : { [RESERVED_ATTRIBUTE_KEYS.definitionVersion]: attribution.definitionVersion }),
    ...(attribution.buildHash === undefined
      ? {}
      : { [RESERVED_ATTRIBUTE_KEYS.buildHash]: attribution.buildHash }),
    ...(attribution.mountToken === undefined
      ? {}
      : { [RESERVED_ATTRIBUTE_KEYS.mountToken]: attribution.mountToken }),
  })
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
