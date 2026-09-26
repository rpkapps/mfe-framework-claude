/**
 * Boot-time developer URL overrides, a URL only: accepting configuration, contract or
 * adapter changes here would turn it into a second configuration surface.
 */

import { createMfeError, type MfeError } from '@company/mfe-core'

/** The documented localStorage key. */
export const OVERRIDES_STORAGE_KEY = 'company:mfe:overrides'

export interface DevOverridesResult {
  /** Definition id → absolute manifest URL, empty when nothing is overridden. */
  readonly overrides: ReadonlyMap<string, string>
  /** Malformed JSON is diagnosed rather than ignored. */
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
    code: 'registry/invalid-entry',
    ...details,
  })
}

/**
 * Loopback on any port and either scheme, because that is where the dev command serves a remote.
 * `URL.hostname` keeps the brackets around an IPv6 address.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

/** `removeItem` too where the host can give it, so a session that changed hands can clear them. */
export type OverrideReadableStorage = Pick<Storage, 'getItem'> &
  Partial<Pick<Storage, 'removeItem'>>

export interface ReadDevOverridesOptions {
  /**
   * Origins besides loopback that an override may point at, each as `URL.origin` prints it
   * (`https://preview.example.com:8443`), matched exactly.
   */
  readonly allowedOrigins?: readonly string[]
}

/** A result carrying nothing but one problem to show the developer. */
function onlyDiagnostic(details: OverrideProblem): DevOverridesResult {
  return { overrides: new Map(), diagnostics: [overrideError(details)] }
}

/**
 * Every failure mode is reported, because an override that silently did nothing is the
 * phantom bug the visible-override requirement exists to prevent. The key is read in deployed
 * builds too, so an override may only point at loopback or an origin the host allows: anything
 * that can write this origin's localStorage could otherwise load its own code into the page.
 */
export function readDevOverrides(
  storage: OverrideReadableStorage | undefined,
  options: ReadDevOverridesOptions = {},
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

    const manifestUrl = parseManifestUrl(url)
    if (manifestUrl === null) {
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

    if (!isAllowedOrigin(manifestUrl, options.allowedOrigins ?? [])) {
      diagnostics.push(
        overrideError({
          id,
          operation: 'read development override URL',
          expected: 'a manifest on localhost, 127.0.0.1 or [::1], or on an origin the shell allows',
          observed: manifestUrl.origin,
          repair: `Serve the remote on localhost, or allow ${manifestUrl.origin} by adding it to overrideOrigins in the shell's createMfeRuntime options.`,
        }),
      )
      continue
    }

    overrides.set(id, url)
  }

  return { overrides, diagnostics }
}

function parseManifestUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function isAllowedOrigin(url: URL, allowedOrigins: readonly string[]): boolean {
  return LOOPBACK_HOSTS.has(url.hostname) || allowedOrigins.includes(url.origin)
}

/**
 * For a tab another user signed in to: overrides point the page at code somebody chose for
 * themselves, so none is applied, and the key is removed where the storage allows it.
 */
export function discardDevOverrides(
  storage: OverrideReadableStorage | undefined,
): DevOverridesResult {
  if (!storage) return EMPTY_RESULT

  let raw: string | null
  try {
    raw = storage.getItem(OVERRIDES_STORAGE_KEY)
  } catch {
    // Unreadable storage holds nothing that could apply.
    return EMPTY_RESULT
  }
  if (raw === null || raw === '') return EMPTY_RESULT

  const removed = removeOverrides(storage)

  return onlyDiagnostic({
    id: OVERRIDES_STORAGE_KEY,
    operation: 'apply development overrides for a different signed-in user',
    expected: 'overrides set by the user signed in to this tab',
    observed: 'overrides left by the user who signed in to this tab before',
    repair: removed
      ? 'Nothing to do: they were not applied and have been removed. Set them again if they are yours.'
      : `They were not applied. Run localStorage.removeItem('${OVERRIDES_STORAGE_KEY}') to remove them.`,
  })
}

function removeOverrides(storage: OverrideReadableStorage): boolean {
  if (storage.removeItem === undefined) return false
  try {
    storage.removeItem(OVERRIDES_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * An override for an id the registry does not list changes nothing, which looks exactly like an
 * override that loaded the wrong build.
 */
export function findUnregisteredOverrides(
  overrides: ReadonlyMap<string, string>,
  registeredIds: ReadonlySet<string>,
): readonly MfeError[] {
  const diagnostics: MfeError[] = []
  for (const [id, url] of overrides) {
    if (registeredIds.has(id)) continue
    diagnostics.push(
      overrideError({
        id,
        operation: 'apply development override',
        expected: 'a definition id listed in registry.json',
        observed: `an override to ${url} for an id no registry entry has`,
        repair: `Use the definition id the registry lists, or remove overrides.${id} in the developer tools.`,
      }),
    )
  }
  return diagnostics
}

/**
 * A multi-definition container whose exports were pointed at different URLs, diagnosed
 * before registration rather than resolved by whichever registered first.
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

/** `getItem` too, so a write preserves the rest of the map. */
export type OverrideWritableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * An empty map removes the key rather than leaving `{}` behind, and false means the browser
 * refused storage, so the caller can say so instead of claiming it worked.
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
