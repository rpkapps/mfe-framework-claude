/**
 * The shell-owned surfaces that legacy apps still depend on.
 *
 * Two things live here because they are the same promise from two directions:
 * the routes the shell keeps serving on a legacy app's behalf, and the release
 * notes it fetches from next to the app's manifest. Both are compatibility
 * paths. Neither is replaced by the new App capabilities — a migrated app that
 * starts owning its own release notes adds a capability, and that addition must
 * not take the fallback away from the apps that have not migrated.
 *
 * All of it is pure: route matching is string work, and the release-notes
 * source takes an injected fetch, so nothing here needs a network or a shell.
 */

import { createMfeError, type NeutralRegistryEntry } from '@company/mfe-core'

/* -------------------------------------------------------------------------- */
/* Shell-owned routes                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The patterns the shell serves for legacy apps, in evaluation order.
 *
 * Order is part of the contract: the shell's own pages come before the
 * per-app forms, and the per-app catch-all comes last so it cannot swallow a
 * more specific legacy route.
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

/** Splits a path into segments, ignoring query, hash and repeated slashes. */
function segmentsOf(pathname: string): readonly string[] {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] ?? ''
  return withoutQuery.split('/').filter(segment => segment !== '')
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
 * Matches a path against the shell-owned legacy routes, returning the first
 * pattern that claims it. Returns null when the shell should look elsewhere,
 * which is what keeps this usable as one branch of the shell's router rather
 * than a router of its own.
 */
export function matchLegacyShellRoute(pathname: string): LegacyShellRouteMatch | null {
  const segments = segmentsOf(pathname)
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

/* -------------------------------------------------------------------------- */
/* Release notes                                                               */
/* -------------------------------------------------------------------------- */

/** Legacy release notes sit next to the container manifest under this name. */
export const LEGACY_RELEASE_NOTES_FILENAME = 'release-notes.md'

export interface ResolveReleaseNotesOptions {
  /** Base for a manifest URL that is not absolute, such as a document URL. */
  readonly base?: string | undefined
}

/**
 * Resolves the release-notes document that sits beside a legacy manifest.
 *
 * It is plain URL resolution — the sibling of the manifest, whatever directory
 * the manifest lives in — so a container that moves its manifest moves its
 * release notes with it and nothing has to be reconfigured.
 */
export function resolveLegacyReleaseNotesUrl(
  manifestUrl: string,
  options: ResolveReleaseNotesOptions = {},
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
      declaredBy: 'The legacy adapter',
      repair:
        'Pass the manifest URL from the registry entry, and a base when the registry stores relative URLs.',
    })
  }

  return new URL(LEGACY_RELEASE_NOTES_FILENAME, manifest).toString()
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

export interface LegacyReleaseNotesSourceOptions extends ResolveReleaseNotesOptions {
  readonly fetch: LegacyReleaseNotesFetch
}

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

/**
 * Fetches a legacy app's release notes from beside its manifest.
 *
 * This stays available for every entry, including one that also advertises the
 * App-owned release-notes capability: the capability is additive, and removing
 * the fallback would break every app that has not migrated yet.
 */
export function createLegacyReleaseNotesSource(
  options: LegacyReleaseNotesSourceOptions,
): LegacyReleaseNotesSource {
  return {
    load: async (entry, init) => {
      const url = resolveLegacyReleaseNotesUrl(entry.manifestUrl, { base: options.base })
      const signal = init?.signal

      let response: Awaited<ReturnType<LegacyReleaseNotesFetch>>
      try {
        response = await options.fetch(url, signal === undefined ? {} : { signal })
      } catch (error) {
        throw createMfeError({
          code: 'config/unreachable',
          id: entry.id,
          operation: 'fetch the legacy release notes',
          expected: `a readable document at ${url}`,
          observed: 'a failed request',
          declaredBy: 'The legacy adapter',
          repair: `Check that ${LEGACY_RELEASE_NOTES_FILENAME} is published next to the container manifest and is readable from the shell's origin.`,
          cause: error,
        })
      }

      if (!response.ok) {
        throw createMfeError({
          code: 'config/unreachable',
          id: entry.id,
          operation: 'fetch the legacy release notes',
          expected: `a readable document at ${url}`,
          observed: `HTTP ${response.status}`,
          declaredBy: 'The legacy adapter',
          repair: `Publish ${LEGACY_RELEASE_NOTES_FILENAME} next to the container manifest, or migrate the app to the App-owned release-notes capability.`,
        })
      }

      return { id: entry.id, url, markdown: await response.text(), source: 'legacy-sibling' }
    },
  }
}

/**
 * Where the shell should read an entry's release notes from.
 *
 * An App that advertises the capability owns its release notes and the shell
 * navigates into it. Everything else keeps the legacy sibling document. This is
 * the additive rule in one place: the new capability is chosen when present,
 * and its absence changes nothing.
 */
export type ReleaseNotesRoute =
  | { readonly kind: 'app-capability'; readonly path: string }
  | { readonly kind: 'legacy-sibling'; readonly url: string }

export function selectReleaseNotesRoute(
  entry: NeutralRegistryEntry,
  options: ResolveReleaseNotesOptions = {},
): ReleaseNotesRoute {
  const capability = entry.capabilities?.find(candidate => candidate.name === 'releaseNotes')
  if (capability) return { kind: 'app-capability', path: capability.path }
  return { kind: 'legacy-sibling', url: resolveLegacyReleaseNotesUrl(entry.manifestUrl, options) }
}
