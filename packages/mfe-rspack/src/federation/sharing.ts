/**
 * The adapter owns the sharing candidate list; an author can only add to it.
 * There is no per-App removal, because a container that opts out of sharing
 * React loads a second React into a page that already has one, and the symptom
 * — hooks failing in a nested tree — never points back at the config.
 */

/**
 * What a candidate needs, independent of any container: whether a second copy
 * of it is tolerable, whether a version mismatch is, and whether it should be
 * bundled into the container's entry unconditionally. `resolveShared` fills in
 * the rest — `requiredVersion` and, for a prefix share, `version` — from what
 * the container actually depends on.
 *
 * A table rather than per-candidate branches in `entry()`: what a candidate
 * needs is a property of the candidate, not of where in a conditional it
 * happens to be checked.
 */
interface SharingPolicy {
  readonly singleton: boolean
  readonly strictVersion: boolean
  readonly eager?: false
}

/** One copy, and a version mismatch between host and remote is an error. */
const SINGLETON: SharingPolicy = { singleton: true, strictVersion: true }

/**
 * The adapter's sharing policy, one entry per candidate it knows about.
 * `resolveShared` intersects the keys here with what a container actually
 * depends on, so a candidate below produces a `shared` entry only where it is
 * used.
 */
const CANDIDATE_POLICY: Readonly<Record<string, SharingPolicy>> = {
  // The framework's own packages are here for the same reason React is: they
  // carry React context across the boundary. A shell renders the mount
  // providers from its copy and the container's route components read them
  // from theirs, so a second copy makes every hook fail with "rendered
  // outside any mount" — while both copies look perfectly correct on their
  // own.
  '@company/mfe-core': SINGLETON,
  '@company/mfe-host': SINGLETON,
  '@company/mfe-react': SINGLETON,
  // One renderer and one DOM binding per document, always.
  react: SINGLETON,
  'react-dom': SINGLETON,
  '@tanstack/react-router': SINGLETON,
  '@tanstack/react-query': SINGLETON,
  // Sonner holds no React context, but its toast queue is module state, which
  // fails the same way context does: the host mounts the one Toaster on the
  // page, and a remote that resolves its own copy pushes onto a queue that
  // Toaster never reads, so its toasts silently never appear.
  sonner: SINGLETON,
  // Not a singleton: the design system publishes no root export, so every
  // import of it is a subpath, and the trailing slash shares each one under
  // its own name rather than matching none of them and letting the container
  // quietly bundle a second copy. Host and remote are allowed to be built
  // against different @tecton/react versions — each renders correctly on its
  // own copy's tokens and components, which is not true of the framework
  // packages above, whose whole job is a provider every mount reads through
  // the *same* context. Module Federation cannot infer this candidate's
  // version from a package.json the way it can for an ordinary dependency —
  // no package is literally named "@tecton/react/" — so `entry()` states one
  // explicitly for every prefix share, this one included.
  '@tecton/react/': { singleton: false, strictVersion: false },
  // Not a singleton, for the same reason as the design system built against
  // it: React Aria's contexts (a label wired to its field, a trigger to its
  // popover) are not shared between copies either way, so host and remote are
  // free to sit on different ~1.21 versions rather than being forced to the
  // one the other happened to install.
  'react-aria-components': { singleton: false, strictVersion: false },
  // Not a singleton, and never eager: the chart component pulls in all of
  // recharts (~145 KB gzipped), so sharing it keeps a page that mounts several
  // charting containers from paying for it more than once, while `eager:
  // false` keeps every container that never charts from paying for it at all.
  recharts: { singleton: false, strictVersion: false, eager: false },
}

/**
 * The candidates the adapter shares when a container depends on them, in the
 * order `CANDIDATE_POLICY` states its policy for each.
 */
export const DEFAULT_SHARED_CANDIDATES: readonly string[] = Object.keys(CANDIDATE_POLICY)

/** The dependency a candidate is satisfied by; a prefix names the package. */
function packageOf(candidate: string): string {
  return candidate.endsWith('/') ? candidate.slice(0, -1) : candidate
}

/**
 * Ranges that name a workspace protocol rather than a version. They mean
 * "whatever is installed", so the build lets Module Federation read the
 * resolved version instead of advertising a range no resolver understands.
 */
const NON_SEMVER_PREFIXES = ['catalog:', 'workspace:', 'link:', 'file:', 'portal:', 'npm:']

export interface SharedModuleConfig {
  /** `false` for a candidate a page may hold more than one copy of. */
  readonly singleton: boolean
  /** `false` for a candidate whose host and remote versions may disagree. */
  readonly strictVersion: boolean
  /**
   * `false` opts a candidate out of eager loading, so only the containers
   * that actually import it pay for its bytes. Left off, Module Federation's
   * own default applies.
   */
  readonly eager?: false
  /**
   * `false` disables the requirement explicitly. Leaving the field off does
   * not: Module Federation then infers one from the nearest package.json,
   * which under a workspace protocol is how a container ends up advertising
   * that it requires version "catalog:".
   */
  readonly requiredVersion: string | false
  /**
   * The version this build actually provides. Module Federation ordinarily
   * reads that from the candidate's own package.json, which is exactly what
   * it cannot do for a prefix share such as `@tecton/react/`: no package is
   * literally named that, so a prefix candidate has to state its version
   * explicitly, the same version its `requiredVersion` was read from.
   */
  readonly version?: string
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
    const range = options.dependencies[packageOf(name)]
    if (range === undefined) continue
    shared[name] = entry(name, range, policyOf(name), installed)
  }

  // Author additions have no policy of their own to look up, and the one
  // supported override is additive rather than a way to relax a candidate the
  // adapter already governs, so every override keeps the strict-singleton
  // policy: a package worth naming explicitly is one whose second copy would
  // carry its own context, same as the framework packages above.
  for (const [name, range] of Object.entries(options.overrides ?? {})) {
    shared[name] = entry(name, range, SINGLETON, installed)
  }

  return Object.fromEntries(Object.entries(shared).sort(([left], [right]) => compare(left, right)))
}

/** A candidate outside `CANDIDATE_POLICY` — a test's own list — is a singleton. */
function policyOf(candidate: string): SharingPolicy {
  return CANDIDATE_POLICY[candidate] ?? SINGLETON
}

/**
 * A workspace protocol means "whatever this workspace installed", so the
 * version it resolved to is the requirement — and it is also the only version
 * this container was built and tested against. Advertising nothing is not an
 * option: Module Federation would infer the protocol string itself as the
 * range, and every consumer's check would fail against it.
 */
function entry(
  candidate: string,
  range: string,
  policy: SharingPolicy,
  installedVersion: (name: string) => string | undefined,
): SharedModuleConfig {
  const name = packageOf(candidate)
  const installed = installedVersion(name)
  const requiredVersion = isUsableVersionRange(range) ? range : (installed ?? false)

  return {
    singleton: policy.singleton,
    strictVersion: policy.strictVersion,
    requiredVersion,
    ...(policy.eager === false ? { eager: false as const } : {}),
    // Module Federation cannot infer a prefix share's version from a
    // package.json — there is no package literally named "@tecton/react/" —
    // so it is told directly, from the same resolution `requiredVersion` used.
    // Left out rather than sent as `undefined` when nothing resolved: unlike
    // `requiredVersion`, `version` has no `false` to disable it explicitly, so
    // omitting the field is the only way to say "unknown" here.
    ...(candidate.endsWith('/') && installed !== undefined ? { version: installed } : {}),
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
