/**
 * The shell-owned surfaces legacy apps still depend on: the routes the shell
 * serves for them, and the release notes beside their manifest. The new App
 * capabilities add to these rather than replace them — an App that owns its
 * release notes must not take the fallback from apps that have not migrated.
 */

import { createMfeError, type MfeError, type NeutralRegistryEntry } from '@company/mfe-core'

/**
 * The patterns the shell serves for legacy apps, in evaluation order. Order is
 * part of the contract: the shell's own pages come before the per-app forms,
 * and the per-app catch-all is last so it cannot swallow a more specific route.
 */
export const LEGACY_SHELL_ROUTE_PATTERNS = [
  'settings',
  ':name/settings',
  'release-notes',
  ':name/release-notes',
  'solutions-health',
  ':name/solutions-health',
  ':name/**',
] as const

export type LegacyShellRoutePattern = (typeof LEGACY_SHELL_ROUTE_PATTERNS)[number]

export interface LegacyShellRouteMatch {
  readonly pattern: LegacyShellRoutePattern
  /** The legacy app name, for the patterns that carry one. */
  readonly name?: string
  /** What the catch-all swallowed. Empty when it matched the app root. */
  readonly rest?: string
}

function matchPattern(
  pattern: LegacyShellRoutePattern,
  segments: readonly string[],
): LegacyShellRouteMatch | null {
  const patternSegments = pattern.split('/')
  const catchAll = patternSegments[patternSegments.length - 1] === '**'
  const fixed = catchAll ? patternSegments.slice(0, -1) : patternSegments

  if (catchAll ? segments.length < fixed.length : segments.length !== fixed.length) return null

  let name: string | undefined
  for (const [index, patternSegment] of fixed.entries()) {
    const segment = segments[index]
    if (segment === undefined) return null
    if (patternSegment === ':name') {
      name = segment
      continue
    }
    if (patternSegment !== segment) return null
  }

  return {
    pattern,
    ...(name === undefined ? {} : { name }),
    ...(catchAll ? { rest: segments.slice(fixed.length).join('/') } : {}),
  }
}

/**
 * Returns the first pattern that claims a path, or null when the shell should
 * look elsewhere — which is what keeps this one branch of the shell's router
 * rather than a router of its own. Query, hash and repeated slashes are ignored.
 */
export function matchLegacyShellRoute(pathname: string): LegacyShellRouteMatch | null {
  const segments = (pathname.split(/[?#]/, 1)[0] ?? '').split('/').filter(segment => segment !== '')
  if (segments.length === 0) return null

  for (const pattern of LEGACY_SHELL_ROUTE_PATTERNS) {
    const match = matchPattern(pattern, segments)
    if (match) return match
  }
  return null
}

export function isLegacyShellRoute(pathname: string): boolean {
  return matchLegacyShellRoute(pathname) !== null
}

/** Legacy release notes sit next to the container manifest under this name. */
const RELEASE_NOTES_FILENAME = 'release-notes.md'

/**
 * Plain URL resolution — the sibling of the manifest, in whatever directory the
 * manifest lives — so a container that moves its manifest moves its release
 * notes with it. A relative manifest URL needs an explicit `base`.
 */
export function resolveLegacyReleaseNotesUrl(
  manifestUrl: string,
  options: { readonly base?: string | undefined } = {},
): string {
  const { base } = options

  let manifest: URL
  try {
    manifest = base === undefined ? new URL(manifestUrl) : new URL(manifestUrl, base)
  } catch {
    throw createMfeError({
      code: 'config/invalid',
      id: manifestUrl,
      operation: 'resolve the legacy release notes URL',
      expected:
        base === undefined
          ? 'an absolute manifest URL, or a base to resolve a relative one against'
          : 'a manifest URL that resolves against the supplied base',
      observed: JSON.stringify(manifestUrl),
      repair: 'Pass a base when the registry stores relative URLs.',
    })
  }

  return new URL(RELEASE_NOTES_FILENAME, manifest).toString()
}

/** The minimum of `fetch` this source uses. Injected, never imported. */
export type LegacyReleaseNotesFetch = (
  url: string,
  init: { readonly signal?: AbortSignal },
) => Promise<{
  readonly ok: boolean
  readonly status: number
  text(): Promise<string>
}>

export interface LegacyReleaseNotes {
  readonly id: string
  readonly url: string
  readonly markdown: string
  /** Always the compatibility path. The App-owned capability is not fetched here. */
  readonly source: 'legacy-sibling'
}

export interface LegacyReleaseNotesSource {
  load(
    entry: NeutralRegistryEntry,
    init?: { readonly signal?: AbortSignal },
  ): Promise<LegacyReleaseNotes>
}

function unreachable(id: string, url: string, observed: string, cause?: unknown): MfeError {
  return createMfeError({
    code: 'config/unreachable',
    id,
    operation: 'fetch the legacy release notes',
    expected: `a readable document at ${url}`,
    observed,
    repair: `Publish ${RELEASE_NOTES_FILENAME} next to the container manifest.`,
    ...(cause === undefined ? {} : { cause }),
  })
}

/**
 * Stays available for every entry, including one that also advertises the
 * App-owned capability: removing the fallback would break every app that has
 * not migrated yet.
 */
export function createLegacyReleaseNotesSource(options: {
  readonly fetch: LegacyReleaseNotesFetch
  readonly base?: string | undefined
}): LegacyReleaseNotesSource {
  return {
    load: async (entry, init) => {
      const url = resolveLegacyReleaseNotesUrl(entry.manifestUrl, { base: options.base })
      const signal = init?.signal

      let response: Awaited<ReturnType<LegacyReleaseNotesFetch>>
      try {
        response = await options.fetch(url, signal === undefined ? {} : { signal })
      } catch (error) {
        throw unreachable(entry.id, url, 'a failed request', error)
      }

      if (!response.ok) throw unreachable(entry.id, url, `HTTP ${response.status}`)

      return { id: entry.id, url, markdown: await response.text(), source: 'legacy-sibling' }
    },
  }
}

/**
 * Where the shell should read an entry's release notes from. The App-owned
 * capability is chosen when present, and its absence changes nothing.
 */
export type ReleaseNotesRoute =
  | { readonly kind: 'app-capability'; readonly path: string }
  | { readonly kind: 'legacy-sibling'; readonly url: string }

export function selectReleaseNotesRoute(
  entry: NeutralRegistryEntry,
  options: { readonly base?: string | undefined } = {},
): ReleaseNotesRoute {
  const capability = entry.capabilities?.find(candidate => candidate.name === 'releaseNotes')
  if (capability) return { kind: 'app-capability', path: capability.path }
  return { kind: 'legacy-sibling', url: resolveLegacyReleaseNotesUrl(entry.manifestUrl, options) }
}
