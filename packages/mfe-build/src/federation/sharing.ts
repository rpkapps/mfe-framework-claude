/**
 * Every framework on a page shares in a scope of its own, named after its exact installed
 * version, and the packages every framework agrees on share in `default`. Nothing is a singleton
 * (§55): containers are released from repositories of their own, so a version a container did not
 * build against is never forced on it. Each candidate resolves to the loaded copy that satisfies
 * the container's range, and a container nothing satisfies uses its own copy rather than failing,
 * so containers whose ranges agree still download one copy.
 *
 * An author can only add to the candidate list; a container that opted out of sharing its
 * framework would always load a second copy, even beside one its range accepts.
 */

import { PAGE_SHARE_SCOPE } from '@company/mfe-core'

export { PAGE_SHARE_SCOPE }

/**
 * What a candidate needs independent of any container; `resolveShared` fills in the versions.
 * There is no singleton flag to set: a policy decides where a candidate is shared, never that a
 * page holds one copy of it.
 */
export interface SharingPolicy {
  readonly eager?: false
  /**
   * `true` for a candidate that imports the framework, or that something importing it keeps
   * state in: it is shared only with containers on the same framework version, because a shared
   * module's own imports resolve in the build that provided it.
   */
  readonly frameworkScoped: boolean
}

/** Each candidate an integration shares, and how; a container shares one it depends on. */
export type SharingPolicies = Readonly<Record<string, SharingPolicy>>

/** Shared with containers on the same framework version, which is what a framework-bound candidate needs. */
export const FRAMEWORK_SCOPED: SharingPolicy = { frameworkScoped: true }

/** Shared with every container, whatever framework it renders with. */
export const PAGE_WIDE: SharingPolicy = { frameworkScoped: false }

/**
 * Shared whatever framework renders: neither imports a framework, so sharing them ties no
 * container to another's framework version. Nothing in them needs one copy per page; what they
 * keep across copies is keyed on the page rather than on the module (§55).
 */
export const PAGE_POLICY: SharingPolicies = {
  '@company/mfe-core': PAGE_WIDE,
  '@company/mfe-runtime': PAGE_WIDE,
}

/**
 * An integration's own candidates behind the page-wide ones, which the build adds itself: an
 * integration that had to list them could forget, and its containers would each bundle a core
 * even beside one their range accepts.
 */
export function withPagePolicy(policy: SharingPolicies): SharingPolicies {
  return { ...PAGE_POLICY, ...policy }
}

/**
 * The dependency a candidate is satisfied by: a prefix (`@scope/pkg/`) and a subpath
 * (`react/jsx-runtime`) both name the package they sit in.
 */
export function packageOf(candidate: string): string {
  const segments = candidate.split('/')
  return segments.slice(0, candidate.startsWith('@') ? 2 : 1).join('/')
}

/** `react@19.3.0`: the framework's name and the exact version its anchor package resolved to. */
export function frameworkShareScope(framework: string, version: string): string {
  return `${framework}@${version}`
}

// A workspace protocol means "whatever is installed", not a range any resolver understands.
const NON_SEMVER_PREFIXES = ['catalog:', 'workspace:', 'link:', 'file:', 'portal:', 'npm:']

export interface SharedModuleConfig {
  /** Always `false`: a page may hold a copy of anything per range that no loaded copy satisfies. */
  readonly singleton: false
  /** Always `false`: a range no loaded copy satisfies falls back to the container's own copy. */
  readonly strictVersion: false
  /** `false` opts out of eager loading; left off, Module Federation's own default applies. */
  readonly eager?: false
  /** `false` disables the requirement; omitting it has Module Federation infer `catalog:`. */
  readonly requiredVersion: string | false
  /** Stated explicitly for a prefix or subpath share, which has no package named after it. */
  readonly version?: string
  /** `default` for a page-wide candidate, the framework's scope for everything bound to it. */
  readonly shareScope: string
}

export interface ResolveSharedOptions {
  /** The integration's candidates and how each is shared. */
  readonly policy: SharingPolicies
  /** The container's `dependencies` and `peerDependencies`, merged. */
  readonly dependencies: Readonly<Record<string, string>>
  /** The scope every framework-bound candidate goes in, from `frameworkShareScope`. */
  readonly frameworkScope: string
  /** The one supported author override: additive, never subtractive. */
  readonly overrides?: Readonly<Record<string, string>>
  /** Overridable for tests; defaults to the policy's candidates, in its order. */
  readonly candidates?: readonly string[]
  /** The version actually installed, injected so this stays a pure function. */
  readonly installedVersion?: (name: string) => string | undefined
}

/** The `shared` block for this container: the candidates it depends on, plus the author's. */
export function resolveShared(
  options: ResolveSharedOptions,
): Readonly<Record<string, SharedModuleConfig>> {
  const candidates = options.candidates ?? Object.keys(options.policy)
  const shared: Record<string, SharedModuleConfig> = {}

  const installed = options.installedVersion ?? (() => undefined)
  const scopeOf = (policy: SharingPolicy): string =>
    policy.frameworkScoped ? options.frameworkScope : PAGE_SHARE_SCOPE

  for (const name of candidates) {
    const range = options.dependencies[packageOf(name)]
    if (range === undefined) continue
    // A candidate outside the policy — a test's own list — is framework-bound.
    const policy = options.policy[name] ?? FRAMEWORK_SCOPED
    shared[name] = entry(name, range, policy, scopeOf(policy), installed)
  }

  // An override adds a candidate or restates one's range, and it stays in the scope the policy
  // gave it: moving a page-wide candidate into a framework scope would give that framework's
  // containers a copy of their own.
  for (const [name, range] of Object.entries(options.overrides ?? {})) {
    const policy = options.policy[name] ?? FRAMEWORK_SCOPED
    shared[name] = entry(name, range, policy, scopeOf(policy), installed)
  }

  return sortedByName(shared)
}

/**
 * The scopes a host registers a container with: `default` always, because the page-wide
 * candidates live there and a remote links only the scopes named when it is registered, then the rest.
 */
export function shareScopesOf(
  shared: Readonly<Record<string, SharedModuleConfig>>,
): readonly string[] {
  const scopes = new Set(Object.values(shared).map(config => config.shareScope))
  scopes.delete(PAGE_SHARE_SCOPE)
  return [PAGE_SHARE_SCOPE, ...[...scopes].sort(compare)]
}

// A workspace protocol resolves to the only version this container was built against, and
// declaring nothing would have Module Federation infer the protocol string as the range.
function entry(
  candidate: string,
  range: string,
  policy: SharingPolicy,
  shareScope: string,
  installedVersion: (name: string) => string | undefined,
): SharedModuleConfig {
  const name = packageOf(candidate)
  const installed = installedVersion(name)
  const requiredVersion = isUsableVersionRange(range) ? range : (installed ?? false)

  return {
    singleton: false,
    strictVersion: false,
    requiredVersion,
    ...(policy.eager === false ? { eager: false as const } : {}),
    // A prefix or subpath share has no package.json of its own to read a version from, and
    // omitting the field is the only way to say "unknown" here, since `version` has no `false` the
    // way `requiredVersion` has.
    ...(candidate !== name && installed !== undefined ? { version: installed } : {}),
    shareScope,
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

/** Sorted by name, so the federation options are stable between builds. */
export function sortedByName(
  shared: Readonly<Record<string, SharedModuleConfig>>,
): Readonly<Record<string, SharedModuleConfig>> {
  return Object.fromEntries(Object.entries(shared).sort(([left], [right]) => compare(left, right)))
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
