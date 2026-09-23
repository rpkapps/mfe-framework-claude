/**
 * Reading the registry: one registry backs every shell surface, so no feature has to know which
 * adapter an entry came from. This package knows the adapter interface and no adapter.
 */

import {
  createMfeError,
  isValidDefinitionId,
  toMfeError,
  DEFINITION_ID_RULE,
  type MfeAdapter,
  type Registry,
  type RegistryEntry,
  type RejectedRegistryEntry,
} from '@company/mfe-core'

export interface ReadRegistryOptions {
  /** Exactly one of these must recognise an entry: none rejects it, two or more rejects it. */
  readonly adapters: readonly MfeAdapter[]
  /** Boot-time URL overrides by definition id. */
  readonly overrides?: ReadonlyMap<string, string>
}

/** Nobody hand-writes registry JSON, so the repair is always the build that published it. */
const REBUILD =
  "Check it against the entry the container's build publishes. Nobody hand-writes registry JSON."

/** Best-effort label for an entry that failed before its id could be trusted. */
function labelFor(raw: unknown, index: number): string {
  if (raw !== null && typeof raw === 'object') {
    const candidate = raw as { id?: unknown; name?: unknown }
    if (typeof candidate.id === 'string' && candidate.id !== '') return candidate.id
    if (typeof candidate.name === 'string' && candidate.name !== '') return candidate.name
  }
  return `<entry at index ${String(index)}>`
}

/** Detection is total by contract; an adapter that throws anyway has not recognised the entry. */
function detects(adapter: MfeAdapter, raw: unknown): boolean {
  try {
    return adapter.detect(raw)
  } catch {
    return false
  }
}

/** Every entry is read independently, so one bad entry loses only itself. */
export function readRegistry(raw: readonly unknown[], options: ReadRegistryOptions): Registry {
  const entries = new Map<string, RegistryEntry>()
  const rejected: RejectedRegistryEntry[] = []
  /** Every entry that took an id, so a duplicate can name all of them together. */
  const claimsById = new Map<string, { source: unknown; index: number }[]>()
  const kinds = options.adapters.map(adapter => adapter.kind).join(', ')

  raw.forEach((source, index) => {
    const id = labelFor(source, index)
    const reject = (reason: string, error: Error): void => {
      rejected.push({ id, reason, error, source })
    }
    const invalid = (
      operation: string,
      expected: string,
      observed: string,
      repair = REBUILD,
    ): Error =>
      createMfeError({ code: 'registry/invalid-entry', id, operation, expected, observed, repair })

    // Exactly one adapter, or the entry is rejected: there is no order to fall back through.
    const recognised = options.adapters.filter(candidate => detects(candidate, source))
    const adapter = recognised.length === 1 ? recognised[0] : undefined

    if (adapter === undefined) {
      const found = recognised.map(candidate => candidate.kind).join(', ')
      reject(
        recognised.length === 0
          ? 'no adapter recognised this entry'
          : `more than one adapter recognised this entry (${found})`,
        invalid(
          'read registry entry',
          `exactly one of the registered adapters (${kinds}) to recognise the entry`,
          recognised.length === 0
            ? 'an entry none of them recognised'
            : `${String(recognised.length)} adapters recognised it (${found})`,
        ),
      )
      return
    }

    let entry: RegistryEntry
    try {
      entry = adapter.parse(source)
    } catch (error) {
      reject(
        `the ${adapter.kind} adapter rejected this entry`,
        toMfeError(error, {
          code: 'registry/invalid-entry',
          id,
          operation: `read ${adapter.kind} registry entry`,
          repair: REBUILD,
        }),
      )
      return
    }

    if (!isValidDefinitionId(entry.id)) {
      reject(
        'invalid definition id',
        invalid(
          'read definition id',
          DEFINITION_ID_RULE,
          JSON.stringify(entry.id),
          'Rename the definition id in its createApp/createWidget call and rebuild.',
        ),
      )
      return
    }

    const claims = claimsById.get(entry.id)
    if (claims) claims.push({ source, index })
    else claimsById.set(entry.id, [{ source, index }])

    const override = options.overrides?.get(entry.id)
    entries.set(
      entry.id,
      override === undefined ? entry : { ...entry, manifestUrl: override, overridden: true },
    )
  })

  // A duplicated id is reported with ALL the conflicting entries, not resolved by whichever
  // entry came last.
  for (const [id, claims] of claimsById) {
    if (claims.length < 2) continue
    entries.delete(id)

    const error = createMfeError({
      code: 'registry/duplicate-id',
      id,
      operation: 'register definition',
      expected: 'one registry entry per definition id',
      observed: `${String(claims.length)} entries using "${id}" (at indexes ${claims.map(claim => claim.index).join(', ')})`,
      repair:
        'Rename one of the definitions and rebuild. Duplicate ids would collide in diagnostics, command attribution and <id>:<key> storage.',
    })

    for (const claim of claims) {
      rejected.push({ id, reason: `duplicate definition id "${id}"`, error, source: claim.source })
    }
  }

  return { entries, rejected }
}
