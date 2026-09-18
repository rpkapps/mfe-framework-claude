/**
 * Module Federation sharing defaults.
 *
 * The adapter owns the candidate list, not the author. What an author can do is
 * add to it; there is no per-App removal, because a container that opts out of
 * sharing React is a container that loads a second React into a page that
 * already has one, and the symptom (hooks failing in a nested tree) never
 * points back at the config that caused it.
 *
 * The defaults are intersected with what the container actually depends on, so
 * a Widget container that never imports a router does not advertise a router
 * share the shell would then have to satisfy.
 */

/** The packages the adapter shares when a container depends on them. */
export const DEFAULT_SHARED_CANDIDATES = [
  'react',
  'react-dom',
  '@tanstack/react-router',
  '@tanstack/react-query',
  '@tecton/react',
] as const

/**
 * Ranges that name a workspace protocol rather than a version. They mean
 * "whatever is installed", so the build lets Module Federation read the
 * resolved version instead of advertising a range no resolver understands.
 */
const NON_SEMVER_PREFIXES = ['catalog:', 'workspace:', 'link:', 'file:', 'portal:', 'npm:']

export interface SharedModuleConfig {
  /** Always true: a second copy of any of these breaks the page, not one MFE. */
  readonly singleton: true
  /** Always true: a version conflict is reported rather than silently resolved. */
  readonly strictVersion: true
  readonly requiredVersion?: string
}

export interface ResolveSharedOptions {
  /** The container's `dependencies` and `peerDependencies`, merged. */
  readonly dependencies: Readonly<Record<string, string>>
  /** The one supported author override: additive, never subtractive. */
  readonly overrides?: Readonly<Record<string, string>>
  /** Overridable for tests; defaults to the adapter's candidate list. */
  readonly candidates?: readonly string[]
}

/**
 * The `shared` block for this container: the adapter's candidates that the
 * container actually depends on, plus whatever the author added.
 */
export function resolveShared(
  options: ResolveSharedOptions,
): Readonly<Record<string, SharedModuleConfig>> {
  const candidates = options.candidates ?? DEFAULT_SHARED_CANDIDATES
  const shared: Record<string, SharedModuleConfig> = {}

  for (const name of candidates) {
    const range = options.dependencies[name]
    if (range === undefined) continue
    shared[name] = entry(range)
  }

  for (const [name, range] of Object.entries(options.overrides ?? {})) {
    shared[name] = entry(range)
  }

  return Object.fromEntries(Object.entries(shared).sort(([left], [right]) => compare(left, right)))
}

function entry(range: string): SharedModuleConfig {
  const usable = isUsableVersionRange(range)
  return {
    singleton: true,
    strictVersion: true,
    ...(usable ? { requiredVersion: range } : {}),
  }
}

/**
 * True when a range is something a version resolver can compare. A workspace
 * protocol is not: advertising `catalog:` as a required version would make
 * every consumer's check fail.
 */
export function isUsableVersionRange(range: string): boolean {
  if (range === '' || range === '*') return false
  return !NON_SEMVER_PREFIXES.some(prefix => range.startsWith(prefix))
}

/** The dependency map the intersection is computed against. */
export function containerDependencies(manifest: {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}): Readonly<Record<string, string>> {
  return { ...manifest.peerDependencies, ...manifest.dependencies }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
