/**
 * The shell-owned surfaces legacy apps still depend on: the routes the shell serves and the
 * release notes beside their manifest. An app that has not migrated keeps this fallback.
 */

import { createMfeError, type MfeError, type RegistryEntry } from '@company/mfe-core'
import { capabilityRoute } from '@company/mfe-runtime'

/** Evaluation order is part of the contract: the catch-all is last so it cannot swallow a route. */
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
  /** What the catch-all swallowed, empty when it matched the app root. */
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

/** The first pattern that claims a path, so legacy routing stays one branch of the shell's router. */
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

/** The manifest's sibling, so a container that moves its manifest moves its release notes. */
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

/** The minimum of `fetch` this source uses, injected rather than imported. */
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
  /** Always the compatibility path; the App-owned capability is not fetched here. */
  readonly source: 'legacy-sibling'
}

export interface LegacyReleaseNotesSource {
  load(entry: RegistryEntry, init?: { readonly signal?: AbortSignal }): Promise<LegacyReleaseNotes>
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

/** Stays available for every entry, because the fallback is all an unmigrated app has. */
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

export type ReleaseNotesRoute =
  | { readonly kind: 'app-capability'; readonly path: string }
  | { readonly kind: 'legacy-sibling'; readonly url: string }

/** Only the legacy branch is this package's: the capability read is a neutral registry question. */
export function selectReleaseNotesRoute(
  entry: RegistryEntry,
  options: { readonly base?: string | undefined } = {},
): ReleaseNotesRoute {
  const path = capabilityRoute(entry, 'releaseNotes')
  if (path !== undefined) return { kind: 'app-capability', path }
  return { kind: 'legacy-sibling', url: resolveLegacyReleaseNotesUrl(entry.manifestUrl, options) }
}
