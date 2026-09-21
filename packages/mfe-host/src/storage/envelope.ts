/**
 * Reading and writing the persisted `{ v, r, g, d }` record, kept apart from the store
 * because it is pure: every failure path is decided here rather than tangled with caching
 * and subscription.
 */

import {
  describeThrown,
  describeValue,
  isStorageEnvelope,
  type MfeError,
  type MfeErrorDetails,
  type StorageArea,
  type StorageRetention,
  type StorageSnapshot,
} from '@company/mfe-core'

import type { z } from 'zod'

export type Detail = Omit<MfeErrorDetails, 'code' | 'id' | 'operation' | 'path'>

export interface EnvelopeDeclaration {
  readonly name: string
  readonly schema: z.ZodType
  readonly retention: StorageRetention
  readonly version: number
  readonly migrate?: (value: unknown, fromVersion: number) => unknown
}

/** What the store lends the envelope logic for one key. */
export interface EnvelopeContext {
  readonly declaration: EnvelopeDeclaration
  readonly physicalKey: string
  readonly area: StorageArea
  readonly defaultSnapshot: StorageSnapshot<unknown>
  // Declared as properties, not methods: `fail` is passed detached to
  // serializeEnvelope, and a method signature would claim a `this` it never has.
  /** Live, because a synchronous migrate() can itself trigger a session transition. */
  readonly generation: () => string | null
  /** Builds and reports the structured failure. */
  readonly fail: (verb: string, detail: Detail) => MfeError
  /** Persists a migrated record, throwing the structured write failure. */
  readonly write: (serialized: string) => void
}

/** `raw` is the string that now represents the stored state; a migration rewrites it. */
export interface ParseOutcome {
  readonly snapshot: StorageSnapshot<unknown>
  readonly raw: string | null
}

/** The first issue, which is the one a developer acts on. */
export function describeIssue(error: {
  readonly issues: readonly { expected?: string; message?: string }[]
}): string {
  const issue = error.issues[0]
  return issue?.expected ?? issue?.message ?? 'schema mismatch'
}

export function readEnvelope(context: EnvelopeContext, raw: string | null): ParseOutcome {
  const { declaration } = context
  if (raw === null) return { snapshot: context.defaultSnapshot, raw: null }

  const bad = (verb: string, detail: Detail): ParseOutcome => ({
    raw,
    snapshot: { status: 'error', error: context.fail(verb, detail) },
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return bad('read', {
      expected: 'a record written through the framework storage boundary',
      observed: `text that is not JSON (${describeThrown(error)})`,
      repair: `Remove '${context.physicalKey}' from ${context.area} storage.`,
      cause: error,
    })
  }

  if (!isStorageEnvelope(parsed)) {
    if (declaration.migrate !== undefined) return migrateInto(context, parsed, 0, raw)
    return bad('read', {
      expected: `a framework envelope at version ${declaration.version}`,
      observed: `an unversioned record (${describeValue(parsed)})`,
      repair: `Declare migrate() on '${declaration.name}' to convert it, or remove the key.`,
    })
  }

  const envelope = parsed
  const generation = context.generation()

  if (envelope.r === 'user') {
    if (generation === null) {
      return bad('read', {
        expected: 'the session generation to be established before a user value is read',
        observed: 'a record retained for the signed-in user, with no session in force',
        repair: 'Give the store its generation before mounting anything that reads session state.',
      })
    }
    // A record from another generation is absent, whether a retired session left it
    // behind or another tab wrote it late.
    if (envelope.g !== generation) return { snapshot: context.defaultSnapshot, raw }
  }

  if (envelope.v === declaration.version) {
    const result = declaration.schema.safeParse(envelope.d)
    if (result.success) return { raw, snapshot: { status: 'value', value: result.data } }
    return bad('read', {
      expected: `a stored value matching the declared schema (${describeIssue(result.error)})`,
      observed: describeValue(envelope.d),
      repair: `Raise the version of '${declaration.name}' and declare migrate(), or remove the key.`,
      cause: result.error,
    })
  }

  if (envelope.v > declaration.version) {
    return bad('read', {
      expected: `version ${declaration.version}`,
      observed: `version ${envelope.v}, written by a newer build`,
      repair: 'Reload into the current build; a record from the future is never overwritten.',
    })
  }

  if (declaration.migrate === undefined) {
    return bad('read', {
      expected: `version ${declaration.version}`,
      observed: `version ${envelope.v} with no migrate() declared`,
      repair: `Declare migrate() on '${declaration.name}', or remove the key.`,
    })
  }

  return migrateInto(context, envelope.d, envelope.v, raw)
}

/**
 * Convert, validate, then write, and only while the generation the conversion started in
 * is still in force.
 */
function migrateInto(
  context: EnvelopeContext,
  input: unknown,
  fromVersion: number,
  raw: string,
): ParseOutcome {
  const { declaration } = context
  const migrate = declaration.migrate
  if (migrate === undefined) return { snapshot: context.defaultSnapshot, raw }

  const bad = (detail: Detail): ParseOutcome => ({
    raw,
    snapshot: { status: 'error', error: context.fail('migrate', detail) },
  })
  const generationAtStart = context.generation()

  let converted: unknown
  try {
    converted = migrate(input, fromVersion)
  } catch (error) {
    return bad({
      expected: `a value at version ${declaration.version}`,
      observed: `migrate() threw (${describeThrown(error)})`,
      repair: `Fix migrate() for '${declaration.name}'. The previous record is preserved.`,
      cause: error,
    })
  }

  const result = declaration.schema.safeParse(converted)
  if (!result.success) {
    return bad({
      expected: `a migrated value matching the declared schema (${describeIssue(result.error)})`,
      observed: describeValue(converted),
      repair: `Fix migrate() for '${declaration.name}'. Nothing was overwritten.`,
      cause: result.error,
    })
  }

  if (declaration.retention === 'user' && context.generation() !== generationAtStart) {
    return bad({
      expected: `the migration to commit in the generation it started in`,
      observed: 'the session moved on while it ran',
      repair: "A retired session's data is never migrated into a new one. Nothing was written.",
    })
  }

  let serialized: string
  try {
    serialized = serializeEnvelope(declaration, context.generation(), result.data, context.fail)
    context.write(serialized)
  } catch (error) {
    return {
      raw,
      snapshot: {
        status: 'error',
        error: error instanceof Error ? error : new Error(describeThrown(error)),
      },
    }
  }
  return { raw: serialized, snapshot: { status: 'value', value: result.data } }
}

export function serializeEnvelope(
  declaration: EnvelopeDeclaration,
  generation: string | null,
  value: unknown,
  fail: (verb: string, detail: Detail) => MfeError,
): string {
  try {
    // An object literal always stringifies to a string or throws, so there is no undefined
    // case to handle here.
    return JSON.stringify({
      v: declaration.version,
      r: declaration.retention,
      // Only the opaque generation is persisted: never a token, never a group list.
      ...(declaration.retention === 'user' && generation !== null ? { g: generation } : {}),
      d: value,
    })
  } catch (error) {
    throw fail('write', {
      expected: 'a JSON-serializable value',
      observed: describeThrown(error),
      repair: 'Store plain JSON; the stored value is unchanged.',
      cause: error,
    })
  }
}
