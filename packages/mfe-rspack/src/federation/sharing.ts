/**
 * An author can only add to the candidate list; a container that opted out of sharing React
 * would load a second one into a page that already has one, and no hook in it would work.
 */

import { shared as designSystemShared } from '@tecton/react/federation/shared'

/** What a candidate needs independent of any container; `resolveShared` fills in the versions. */
interface SharingPolicy {
  readonly singleton: boolean
  readonly strictVersion: boolean
  readonly eager?: false
}

const SINGLETON: SharingPolicy = { singleton: true, strictVersion: true }

// These carry React context across the boundary, so a second copy makes every hook fail with
// "rendered outside any mount" while both copies look perfectly correct on their own.
const FRAMEWORK_POLICY: Readonly<Record<string, SharingPolicy>> = {
  '@company/mfe-core': SINGLETON,
  '@company/mfe-host': SINGLETON,
  '@company/mfe-react': SINGLETON,
  '@tanstack/react-router': SINGLETON,
  '@tanstack/react-query': SINGLETON,
}

// The library states its own contract; `strictVersion` is the one thing it leaves out, and a
// mismatch is an error exactly where a second copy would be.
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

const CANDIDATE_POLICY: Readonly<Record<string, SharingPolicy>> = {
  ...FRAMEWORK_POLICY,
  ...DESIGN_SYSTEM_POLICY,
}

/** The candidates the adapter shares, each only when a container depends on it. */
export const DEFAULT_SHARED_CANDIDATES: readonly string[] = Object.keys(CANDIDATE_POLICY)

/** The dependency a candidate is satisfied by; a prefix names the package. */
export function packageOf(candidate: string): string {
  return candidate.endsWith('/') ? candidate.slice(0, -1) : candidate
}

// A workspace protocol means "whatever is installed", not a range any resolver understands.
const NON_SEMVER_PREFIXES = ['catalog:', 'workspace:', 'link:', 'file:', 'portal:', 'npm:']

export interface SharedModuleConfig {
  /** `false` for a candidate a page may hold more than one copy of. */
  readonly singleton: boolean
  /** `false` for a candidate whose host and remote versions may disagree. */
  readonly strictVersion: boolean
  /** `false` opts out of eager loading; left off, Module Federation's own default applies. */
  readonly eager?: false
  /** `false` disables the requirement; omitting it has Module Federation infer `catalog:`. */
  readonly requiredVersion: string | false
  /** Stated explicitly because no package is literally named `@tecton/react/` to read it from. */
  readonly version?: string
}

export interface ResolveSharedOptions {
  /** The container's `dependencies` and `peerDependencies`, merged. */
  readonly dependencies: Readonly<Record<string, string>>
  /** The one supported author override: additive, never subtractive. */
  readonly overrides?: Readonly<Record<string, string>>
  /** Overridable for tests; defaults to the adapter's candidate list. */
  readonly candidates?: readonly string[]
  /** The version actually installed, injected so this stays a pure function. */
  readonly installedVersion?: (name: string) => string | undefined
}

/** The `shared` block for this container: the candidates it depends on, plus the author's. */
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

  // An override is additive rather than a way to relax a candidate, so it stays a singleton.
  for (const [name, range] of Object.entries(options.overrides ?? {})) {
    shared[name] = entry(name, range, SINGLETON, installed)
  }

  return Object.fromEntries(Object.entries(shared).sort(([left], [right]) => compare(left, right)))
}

/** A candidate outside `CANDIDATE_POLICY` — a test's own list — is a singleton. */
function policyOf(candidate: string): SharingPolicy {
  return CANDIDATE_POLICY[candidate] ?? SINGLETON
}

// A workspace protocol resolves to the only version this container was built against, and
// advertising nothing would have Module Federation infer the protocol string as the range.
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
    // A prefix share has no package.json to read a version from, and omitting the field is the
    // only way to say "unknown" here, since `version` has no `false` the way `requiredVersion` has.
    ...(candidate.endsWith('/') && installed !== undefined ? { version: installed } : {}),
  }
}

/** True when a range is something a version resolver can compare; a workspace protocol is not. */
export function isUsableVersionRange(range: string): boolean {
  if (range === '' || range === '*') return false
  return !NON_SEMVER_PREFIXES.some(prefix => range.startsWith(prefix))
}

export function containerDependencies(manifest: {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}): Readonly<Record<string, string>> {
  return { ...manifest.peerDependencies, ...manifest.dependencies }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
