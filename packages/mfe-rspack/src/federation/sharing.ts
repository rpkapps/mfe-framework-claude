/**
 * The adapter owns the sharing candidate list; an author can only add to it.
 * There is no per-App removal, because a container that opts out of sharing
 * React loads a second React into a page that already has one, and the symptom
 * — hooks failing in a nested tree — never points back at the config.
 */

/**
 * The packages the adapter shares when a container depends on them.
 *
 * The framework's own packages are on this list for the same reason React is:
 * they carry React context across the boundary. A shell renders the mount
 * providers from its copy and the container's route components read them from
 * theirs, so a second copy makes every hook fail with "rendered outside any
 * mount" — while both copies look perfectly correct on their own.
 */
export const DEFAULT_SHARED_CANDIDATES = [
  '@company/mfe-core',
  '@company/mfe-host',
  '@company/mfe-react',
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
  /**
   * `false` disables the requirement explicitly. Leaving the field off does
   * not: Module Federation then infers one from the nearest package.json,
   * which under a workspace protocol is how a container ends up advertising
   * that it requires version "catalog:".
   */
  readonly requiredVersion: string | false
}

export interface ResolveSharedOptions {
  /** The container's `dependencies` and `peerDependencies`, merged. */
  readonly dependencies: Readonly<Record<string, string>>
  /** The one supported author override: additive, never subtractive. */
  readonly overrides?: Readonly<Record<string, string>>
  /** Overridable for tests; defaults to the adapter's candidate list. */
  readonly candidates?: readonly string[]
  /**
   * The version actually installed for a package, which is what a workspace
   * protocol resolved to. Injected so this stays a pure function.
   */
  readonly installedVersion?: (name: string) => string | undefined
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

  const installed = options.installedVersion ?? (() => undefined)

  for (const name of candidates) {
    const range = options.dependencies[name]
    if (range === undefined) continue
    shared[name] = entry(name, range, installed)
  }

  for (const [name, range] of Object.entries(options.overrides ?? {})) {
    shared[name] = entry(name, range, installed)
  }

  return Object.fromEntries(Object.entries(shared).sort(([left], [right]) => compare(left, right)))
}

/**
 * A workspace protocol means "whatever this workspace installed", so the
 * version it resolved to is the requirement — and it is also the only version
 * this container was built and tested against. Advertising nothing is not an
 * option: Module Federation would infer the protocol string itself as the
 * range, and every consumer's check would fail against it.
 */
function entry(
  name: string,
  range: string,
  installedVersion: (name: string) => string | undefined,
): SharedModuleConfig {
  if (isUsableVersionRange(range)) {
    return { singleton: true, strictVersion: true, requiredVersion: range }
  }

  const installed = installedVersion(name)
  return {
    singleton: true,
    strictVersion: true,
    requiredVersion: installed ?? false,
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
