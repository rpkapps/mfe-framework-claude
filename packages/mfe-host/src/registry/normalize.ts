/**
 * Registry normalization and table-driven adapter selection: one normalized
 * registry backs every shell surface, so no feature has to know which adapter
 * an entry belongs to, and adding an adapter is a table entry.
 */

import {
  createMfeError,
  isValidDefinitionId,
  toMfeError,
  DEFINITION_ID_RULE,
  type AdapterSelectionRule,
  type NeutralRegistryEntry,
  type NormalizedRegistry,
  type QuarantinedRegistryEntry,
} from '@company/mfe-core'

export interface NormalizeRegistryOptions {
  /**
   * Ordered selection table. The first rule whose `advertises` returns true owns
   * the entry, including when its `normalize` then fails — that is the
   * no-silent-fallback rule.
   */
  readonly rules: readonly AdapterSelectionRule[]
  /** Boot-time URL overrides by definition id. */
  readonly overrides?: ReadonlyMap<string, string>
}

/** Best-effort label for an entry that failed before its id could be trusted. */
function labelFor(source: unknown, index: number): string {
  if (source !== null && typeof source === 'object') {
    const candidate = source as { id?: unknown; name?: unknown }
    if (typeof candidate.id === 'string' && candidate.id !== '') return candidate.id
    if (typeof candidate.name === 'string' && candidate.name !== '') return candidate.name
  }
  return `<entry at index ${index}>`
}

function quarantine(
  source: unknown,
  index: number,
  reason: string,
  error: Error,
): QuarantinedRegistryEntry {
  return { id: labelFor(source, index), reason, error, source }
}

/** Every entry is validated independently, so one malformed entry loses only itself. */
export function normalizeRegistry(
  sources: readonly unknown[],
  options: NormalizeRegistryOptions,
): NormalizedRegistry {
  const accepted = new Map<string, NeutralRegistryEntry>()
  const quarantined: QuarantinedRegistryEntry[] = []
  /** Every entry that claimed an id, so duplicates can name all conflicting sources. */
  const claimsById = new Map<string, { source: unknown; index: number }[]>()

  sources.forEach((source, index) => {
    const rule = options.rules.find(candidate => safeAdvertises(candidate, source))

    if (!rule) {
      quarantined.push(
        quarantine(
          source,
          index,
          'no adapter recognised this descriptor',
          createMfeError({
            code: 'registry/invalid-descriptor',
            id: labelFor(source, index),
            operation: 'read registry entry',
            expected: `a descriptor matching one of the registered adapters (${options.rules.map(candidate => candidate.adapter).join(', ')})`,
            observed: 'a descriptor that matched none of them',
            repair:
              'Check the entry against the generated registry descriptor produced by its build. Nobody hand-writes registry JSON.',
          }),
        ),
      )
      return
    }

    let entry: NeutralRegistryEntry
    try {
      entry = rule.normalize(source)
    } catch (error) {
      quarantined.push(
        quarantine(
          source,
          index,
          `the ${rule.adapter} adapter rejected this descriptor`,
          toMfeError(error, {
            code: 'registry/invalid-descriptor',
            id: labelFor(source, index),
            operation: `validate ${rule.adapter} registry entry`,
            repair:
              'Fix the advertised contract. An entry that advertises a contract is never reinterpreted as another adapter.',
          }),
        ),
      )
      return
    }

    if (!isValidDefinitionId(entry.id)) {
      quarantined.push(
        quarantine(
          source,
          index,
          'invalid definition id',
          createMfeError({
            code: 'registry/invalid-descriptor',
            id: labelFor(source, index),
            operation: 'read definition id',
            expected: DEFINITION_ID_RULE,
            observed: JSON.stringify(entry.id),
            repair: 'Rename the definition id in its createApp/createWidget call and rebuild.',
          }),
        ),
      )
      return
    }

    const claims = claimsById.get(entry.id)
    if (claims) claims.push({ source, index })
    else claimsById.set(entry.id, [{ source, index }])

    const override = options.overrides?.get(entry.id)
    accepted.set(
      entry.id,
      override === undefined ? entry : { ...entry, manifestUrl: override, overridden: true },
    )
  })

  // Duplicate ids are rejected deterministically and reported with ALL the
  // conflicting entries — not resolved by whichever entry came last.
  for (const [id, claims] of claimsById) {
    if (claims.length < 2) continue
    accepted.delete(id)

    const error = createMfeError({
      code: 'registry/duplicate-id',
      id,
      operation: 'register definition',
      expected: 'one registry entry per definition id',
      observed: `${claims.length} entries claiming "${id}" (at indexes ${claims.map(claim => claim.index).join(', ')})`,
      repair:
        'Rename one of the definitions and rebuild. Duplicate ids would collide in diagnostics, command attribution and <id>:<key> storage.',
    })

    for (const claim of claims) {
      quarantined.push(
        quarantine(claim.source, claim.index, `duplicate definition id "${id}"`, error),
      )
    }
  }

  return { entries: accepted, quarantined }
}

/**
 * Treating a throw during *detection* as "not mine" is safe: a genuinely
 * malformed advertised contract still fails explicitly inside `normalize`.
 */
function safeAdvertises(rule: AdapterSelectionRule, source: unknown): boolean {
  try {
    return rule.advertises(source)
  } catch {
    return false
  }
}
