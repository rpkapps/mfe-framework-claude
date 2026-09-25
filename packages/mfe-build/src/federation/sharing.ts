/**
 * Every framework on a page shares in a scope of its own, named after its exact installed
 * version, and the packages every framework agrees on share in `default`. Inside a scope the rule
 * is one strict copy, so containers built on the same framework version download it once, a
 * container on another version brings its own complete set, and a mismatch fails at load.
 *
 * An author can only add to the candidate list; a container that opted out of sharing its
 * framework would load a second copy into a scope that already has one, and nothing that keeps
 * state in the first would reach it.
 */

import { PAGE_SHARE_SCOPE } from '@company/mfe-core'

export { PAGE_SHARE_SCOPE }

/** What a candidate needs independent of any container; `resolveShared` fills in the versions. */
export interface SharingPolicy {
  readonly singleton: boolean
  readonly strictVersion: boolean
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

/** One copy per framework version, which is what every framework-bound candidate needs. */
export const SINGLETON: SharingPolicy = {
  singleton: true,
  strictVersion: true,
  frameworkScoped: true,
}

/**
 * One copy per page, whatever framework a container renders with, for the neutral packages whose
 * module state spans the page.
 */
export const PAGE_SINGLETON: SharingPolicy = {
  singleton: true,
  strictVersion: true,
  frameworkScoped: false,
}

/**
 * The page's singletons whatever framework renders: the mount-token sequence, and the `instanceof`
 * checks errors and spans are recognised by, are module state in these, and neither imports a
 * framework, so pinning them pins no container's framework.
 */
export const PAGE_POLICY: SharingPolicies = {
  '@company/mfe-core': PAGE_SINGLETON,
  '@company/mfe-runtime': PAGE_SINGLETON,
}

/**
 * An integration's own candidates behind the page singletons, which the build adds itself: an
 * integration that had to list them could forget, and its containers would each bundle a second
 * core.
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
  /** `false` for a candidate a page may hold more than one copy of. */
  readonly singleton: boolean
  /** `false` for a candidate whose host and remote versions may disagree. */
  readonly strictVersion: boolean
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
    // A candidate outside the policy — a test's own list — is a framework singleton.
    const policy = options.policy[name] ?? SINGLETON
    shared[name] = entry(name, range, policy, scopeOf(policy), installed)
  }

  // An override adds a candidate or tightens one to a singleton, and it stays in the scope the
  // policy gave it: moving a page singleton into a framework scope would give that framework's
  // containers a second copy of it.
  for (const [name, range] of Object.entries(options.overrides ?? {})) {
    const existing = options.policy[name]
    const policy =
      existing === undefined
        ? SINGLETON
        : { ...SINGLETON, frameworkScoped: existing.frameworkScoped }
    shared[name] = entry(name, range, policy, scopeOf(policy), installed)
  }

  return sortedByName(shared)
}

/**
 * The scopes a host registers a container with: `default` always, because the page singletons
 * live there and a remote links only the scopes named when it is registered, then the rest.
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
    singleton: policy.singleton,
    strictVersion: policy.strictVersion,
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
