/**
 * An author can only add to the candidate list; a container that opted out of sharing React
 * would load a second one into a page that already has one, and no hook in it would work.
 */

import { createRequire } from 'node:module'

import type { DefinitionFramework } from '@company/mfe-core'

/** What a candidate needs independent of any container; `resolveShared` fills in the versions. */
interface SharingPolicy {
  readonly singleton: boolean
  readonly strictVersion: boolean
  readonly eager?: false
}

const SINGLETON: SharingPolicy = { singleton: true, strictVersion: true }

// These carry React context across the boundary, so a second copy makes every hook fail with
// "rendered outside any mount" while both copies look perfectly correct on their own. React itself
// is listed too, so a container that renders no design system still shares the one React.
const REACT_FRAMEWORK_POLICY: Readonly<Record<string, SharingPolicy>> = {
  '@company/mfe-core': SINGLETON,
  '@company/mfe-host': SINGLETON,
  '@company/mfe-react': SINGLETON,
  '@tanstack/react-router': SINGLETON,
  '@tanstack/react-query': SINGLETON,
  react: SINGLETON,
  'react-dom': SINGLETON,
}

// The React shell provides none of these, so the first Angular container on a page provides them
// to the ones after it. A second copy of the core means a second injector tree and change-detection
// scheduler, and a second RxJS fails every `instanceof Observable` across the boundary.
const ANGULAR_FRAMEWORK_POLICY: Readonly<Record<string, SharingPolicy>> = {
  '@company/mfe-core': SINGLETON,
  '@company/mfe-host': SINGLETON,
  '@company/mfe-angular': SINGLETON,
  '@angular/core': SINGLETON,
  '@angular/common': SINGLETON,
  '@angular/common/http': SINGLETON,
  '@angular/platform-browser': SINGLETON,
  '@angular/router': SINGLETON,
  '@angular/forms': SINGLETON,
  rxjs: SINGLETON,
}

const DESIGN_SYSTEM_SHARED = '@tecton/react/federation/shared'

interface DesignSystemShared {
  readonly shared: Readonly<
    Record<string, { readonly singleton: boolean; readonly eager?: boolean }>
  >
}

/**
 * The design system is an optional peer, so a build without it — every Angular container's —
 * shares nothing on its behalf. Only its absence is tolerated: a copy that is installed but fails
 * to load is an error here, as it was when this was a static import.
 */
function readDesignSystemShared(): DesignSystemShared['shared'] {
  try {
    // `require` of an ES module hands back its namespace object, which carries `shared`.
    return (createRequire(import.meta.url)(DESIGN_SYSTEM_SHARED) as DesignSystemShared).shared
  } catch (error) {
    if ((error as { code?: unknown }).code === 'MODULE_NOT_FOUND') return {}
    throw error
  }
}

// The library states its own contract; `strictVersion` is the one thing it leaves out, and a
// mismatch is an error exactly where a second copy would be.
const DESIGN_SYSTEM_POLICY: Readonly<Record<string, SharingPolicy>> = Object.fromEntries(
  Object.entries(readDesignSystemShared()).map(([name, policy]): [string, SharingPolicy] => [
    name,
    {
      singleton: policy.singleton,
      strictVersion: policy.singleton,
      ...(policy.eager === false ? { eager: false as const } : {}),
    },
  ]),
)

// The design system renders React, so it is part of the React policy only.
const CANDIDATE_POLICY: Readonly<
  Record<DefinitionFramework, Readonly<Record<string, SharingPolicy>>>
> = {
  react: { ...REACT_FRAMEWORK_POLICY, ...DESIGN_SYSTEM_POLICY },
  angular: ANGULAR_FRAMEWORK_POLICY,
}

/** The candidates a React container or host shares, each only when it depends on it. */
export const DEFAULT_SHARED_CANDIDATES: readonly string[] = Object.keys(CANDIDATE_POLICY.react)

/** The dependency a candidate is satisfied by: a prefix or a subpath names its package. */
export function packageOf(candidate: string): string {
  const segments = candidate.split('/')
  return candidate.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? candidate)
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
  /** The adapter whose policy applies; a host shares what the React shell holds. */
  readonly framework?: DefinitionFramework
  /** The container's `dependencies` and `peerDependencies`, merged. */
  readonly dependencies: Readonly<Record<string, string>>
  /** The one supported author override: additive, never subtractive. */
  readonly overrides?: Readonly<Record<string, string>>
  /** Overridable for tests; defaults to the framework's candidate list. */
  readonly candidates?: readonly string[]
  /** The version actually installed, injected so this stays a pure function. */
  readonly installedVersion?: (name: string) => string | undefined
}

/** The `shared` block for this container: the candidates it depends on, plus the author's. */
export function resolveShared(
  options: ResolveSharedOptions,
): Readonly<Record<string, SharedModuleConfig>> {
  const policy = CANDIDATE_POLICY[options.framework ?? 'react']
  const candidates = options.candidates ?? Object.keys(policy)
  const shared: Record<string, SharedModuleConfig> = {}

  const installed = options.installedVersion ?? (() => undefined)

  for (const name of candidates) {
    const range = options.dependencies[packageOf(name)]
    if (range === undefined) continue
    // A candidate outside the policy — a test's own list — is a singleton.
    shared[name] = entry(name, range, policy[name] ?? SINGLETON, installed)
  }

  // An override is additive rather than a way to relax a candidate, so it stays a singleton.
  for (const [name, range] of Object.entries(options.overrides ?? {})) {
    shared[name] = entry(name, range, SINGLETON, installed)
  }

  return Object.fromEntries(Object.entries(shared).sort(([left], [right]) => compare(left, right)))
}

// A workspace protocol resolves to the only version this container was built against, and
// declaring nothing would have Module Federation infer the protocol string as the range.
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
