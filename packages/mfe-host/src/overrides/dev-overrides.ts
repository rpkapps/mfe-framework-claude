/**
 * Boot-time developer URL overrides. A URL only: accepting configuration,
 * contract or adapter changes here is what would turn it into a second
 * configuration surface.
 */

import { createMfeError, type MfeError } from '@company/mfe-core'

/** The documented localStorage key. */
export const OVERRIDES_STORAGE_KEY = 'company:mfe:overrides'

export interface DevOverridesResult {
  /** Definition id → absolute manifest URL. Empty when nothing is overridden. */
  readonly overrides: ReadonlyMap<string, string>
  /** Problems worth showing a developer. Malformed JSON is diagnosed, not ignored. */
  readonly diagnostics: readonly MfeError[]
}

const EMPTY_RESULT: DevOverridesResult = Object.freeze({
  overrides: new Map<string, string>(),
  diagnostics: [],
})

interface OverrideProblem {
  readonly id: string
  readonly operation: string
  readonly expected: string
  readonly observed: string
  readonly repair: string
}

function overrideError(details: OverrideProblem): MfeError {
  return createMfeError({
    code: 'registry/invalid-descriptor',
    ...details,
  })
}

/** A result carrying nothing but one problem to show the developer. */
function onlyDiagnostic(details: OverrideProblem): DevOverridesResult {
  return { overrides: new Map(), diagnostics: [overrideError(details)] }
}

/**
 * Reads overrides before remotes are registered. Every failure mode is
 * reported: an override that silently did nothing is the phantom bug the
 * visible-override requirement exists to prevent.
 */
export function readDevOverrides(
  storage: Pick<Storage, 'getItem'> | undefined,
): DevOverridesResult {
  if (!storage) return EMPTY_RESULT

  let raw: string | null
  try {
    raw = storage.getItem(OVERRIDES_STORAGE_KEY)
  } catch (error) {
    return onlyDiagnostic({
      id: OVERRIDES_STORAGE_KEY,
      operation: 'read development overrides',
      expected: 'readable localStorage',
      observed: error instanceof Error ? `${error.name}: ${error.message}` : 'an access error',
      repair:
        'Browser storage is blocked for this origin. Development overrides are unavailable until it is allowed.',
    })
  }

  if (raw === null || raw === '') return EMPTY_RESULT

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return onlyDiagnostic({
      id: OVERRIDES_STORAGE_KEY,
      operation: 'parse development overrides',
      expected: 'a JSON object mapping definition ids to absolute manifest URLs',
      observed: 'text that is not valid JSON',
      repair: `Run localStorage.removeItem('${OVERRIDES_STORAGE_KEY}') and set the override again using the snippet the dev command prints.`,
    })
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return onlyDiagnostic({
      id: OVERRIDES_STORAGE_KEY,
      operation: 'read development overrides',
      expected: 'a JSON object mapping definition ids to absolute manifest URLs',
      observed: Array.isArray(parsed) ? 'an array' : `a ${typeof parsed}`,
      repair: `Set it to an object, for example {"operations":"http://localhost:3001/mf-manifest.json"}.`,
    })
  }

  const overrides = new Map<string, string>()
  const diagnostics: MfeError[] = []

  for (const [id, url] of Object.entries(parsed)) {
    if (typeof url !== 'string' || url === '') {
      diagnostics.push(
        overrideError({
          id,
          operation: 'read development override URL',
          expected: 'an absolute manifest URL string',
          observed: url === undefined ? 'nothing' : `a ${typeof url}`,
          repair: `Set overrides.${id} to the manifest URL the dev command prints, or delete the key.`,
        }),
      )
      continue
    }

    if (!isAbsoluteUrl(url)) {
      diagnostics.push(
        overrideError({
          id,
          operation: 'read development override URL',
          expected: 'an absolute URL, for example http://localhost:3001/mf-manifest.json',
          observed: JSON.stringify(url),
          repair:
            'Use the absolute manifest URL the dev command prints; relative URLs resolve against the shell, not the remote.',
        }),
      )
      continue
    }

    overrides.set(id, url)
  }

  return { overrides, diagnostics }
}

function isAbsoluteUrl(value: string): boolean {
  try {
    return new URL(value).protocol.startsWith('http')
  } catch {
    return false
  }
}

/**
 * A multi-definition container whose exports were pointed at different URLs,
 * diagnosed before registration rather than resolved by whichever registered
 * first.
 */
export function findConflictingContainerOverrides(
  overrides: ReadonlyMap<string, string>,
  containersByDefinitionId: ReadonlyMap<string, string>,
): readonly MfeError[] {
  const urlsByContainer = new Map<string, Map<string, string>>()

  for (const [id, url] of overrides) {
    const container = containersByDefinitionId.get(id)
    if (container === undefined) continue
    const byId = urlsByContainer.get(container)
    if (byId) byId.set(id, url)
    else urlsByContainer.set(container, new Map([[id, url]]))
  }

  const diagnostics: MfeError[] = []
  for (const [container, byId] of urlsByContainer) {
    const distinct = new Set(byId.values())
    if (distinct.size < 2) continue

    diagnostics.push(
      overrideError({
        id: container,
        operation: 'register overridden container',
        expected: 'one consistent override URL for every definition exported by a container',
        observed: [...byId].map(([id, url]) => `${id} → ${url}`).join(', '),
        repair:
          'Point every definition from this container at the same manifest URL. One container is loaded once; conflicting URLs cannot both apply.',
      }),
    )
  }

  return diagnostics
}

/** What writing an override needs. `getItem` too, so a write preserves the rest. */
export type OverrideWritableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Replaces the whole override map. An empty map removes the key rather than
 * leaving `{}` behind, so "no overrides" reads the same as never having set
 * one. Returns false when the browser refuses storage for this origin, so the
 * caller can say so instead of claiming it worked.
 */
export function writeDevOverrides(
  storage: OverrideWritableStorage | undefined,
  overrides: ReadonlyMap<string, string>,
): boolean {
  if (!storage) return false

  try {
    if (overrides.size === 0) storage.removeItem(OVERRIDES_STORAGE_KEY)
    else storage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(Object.fromEntries(overrides)))
    return true
  } catch {
    return false
  }
}
