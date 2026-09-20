/**
 * The adapter owns the sharing candidate list; an author can only add to it.
 * There is no per-App removal, because a container that opts out of sharing
 * React loads a second React into a page that already has one, and the symptom
 * — hooks failing in a nested tree — never points back at the config.
 *
 * Half the list is not the framework's to write. Which of the design system's
 * dependencies a page may hold two copies of follows from where that library
 * keeps module state, so it publishes the answer as data and this reads it.
 */

import { shared as designSystemShared } from '@tecton/react/federation/shared'

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
 * The framework's own candidates. They carry React context across the
 * boundary: a shell renders the mount providers from its copy and the
 * container's route components read them from theirs, so a second copy makes
 * every hook fail with "rendered outside any mount" — while both copies look
 * perfectly correct on their own. The router and the query client are the same
 * story with their own contexts, and a boundary route reads both.
 */
const FRAMEWORK_POLICY: Readonly<Record<string, SharingPolicy>> = {
  '@company/mfe-core': SINGLETON,
  '@company/mfe-host': SINGLETON,
  '@company/mfe-react': SINGLETON,
  '@tanstack/react-router': SINGLETON,
  '@tanstack/react-query': SINGLETON,
}

/**
 * The design system's dependencies, as its own contract states them — React
 * and its DOM binding included, since the library is where they are shared
 * from. The reason for each entry lives there rather than being restated here,
 * and so does the trailing slash on `@tecton/react/`: the package publishes no
 * root export, so every import of it is a subpath and the prefix shares each
 * one under its own name.
 *
 * `strictVersion` is the one thing the contract leaves out, and it follows
 * from `singleton`: a version mismatch is an error exactly where a second copy
 * would be.
 */
const DESIGN_SYSTEM_POLICY: Readonly<Record<string, SharingPolicy>> = Object.fromEntries(
  Object.entries(designSystemShared).map(([name, policy]): [string, SharingPolicy] => [
    name,
    {
      singleton: policy.singleton,
      strictVersion: policy.singleton,
      ...(policy.eager === false ? { eager: false as const } : {}),
    },
  ]),
)

/**
 * The adapter's sharing policy, one entry per candidate it knows about: the
 * framework's own, then the design system's. `resolveShared` intersects the
 * keys here with what a container actually depends on, so a candidate below
 * produces a `shared` entry only where it is used.
 */
const CANDIDATE_POLICY: Readonly<Record<string, SharingPolicy>> = {
  ...FRAMEWORK_POLICY,
  ...DESIGN_SYSTEM_POLICY,
}

/**
 * The candidates the adapter shares when a container depends on them, in the
 * order `CANDIDATE_POLICY` states its policy for each.
 */
export const DEFAULT_SHARED_CANDIDATES: readonly string[] = Object.keys(CANDIDATE_POLICY)

/** The dependency a candidate is satisfied by; a prefix names the package. */
export function packageOf(candidate: string): string {
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
