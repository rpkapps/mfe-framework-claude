import { join } from 'node:path'

import {
  createBuildError,
  installedVersionFrom,
  packageOf,
  resolveShared,
  type SharedModuleConfig,
} from '@company/mfe-build/federation'

import { DEFAULT_SHARED_CANDIDATES, REACT_SHARING_POLICY } from './sharing.ts'

export type { SharedModuleConfig } from '@company/mfe-build/federation'

export interface HostSharedOptions {
  /** The directory holding the host's package.json; every candidate is resolved from it. */
  readonly root: string
  /** Injected so the policy can be exercised without an install; defaults to reading `root`. */
  readonly installedVersion?: (name: string) => string | undefined
}

/**
 * The `shared` map for a host's `moduleFederation.options`; a host provides the modules, so it
 * declares the version installed and shares what resolves rather than what it lists (§27).
 */
export function hostShared(
  options: HostSharedOptions,
): Readonly<Record<string, SharedModuleConfig>> {
  const installedVersion = options.installedVersion ?? installedVersionFrom(options.root)

  const installed: Record<string, string> = {}
  for (const candidate of DEFAULT_SHARED_CANDIDATES) {
    const name = packageOf(candidate)
    const version = installedVersion(name)
    if (version !== undefined) installed[name] = version
  }

  // A root that resolves none of the candidates is not where this host's modules are (§27).
  if (Object.keys(installed).length === 0) {
    throw createBuildError({
      file: join(options.root, 'package.json'),
      operation: 'resolve the share scope for the federation host',
      expected: 'a host root whose node_modules holds at least one shared candidate',
      observed: 'a root that resolved none of them',
      declaredBy: 'The build integration',
      repair:
        "Pass `root` the directory holding the host's package.json — in an Rsbuild config, dirname(fileURLToPath(import.meta.url)) — and install its dependencies.",
    })
  }

  return resolveShared({ policy: REACT_SHARING_POLICY, dependencies: installed, installedVersion })
}

// `version-first` re-initialises every registered remote before resolving a share, so one
// unreachable manifest takes down surfaces that never touched it (§30).
const HOST_SHARE_STRATEGY = 'loaded-first' as const

export interface HostFederationOptions {
  readonly shared: Readonly<Record<string, SharedModuleConfig>>
  readonly shareStrategy: typeof HOST_SHARE_STRATEGY
}

/**
 * The scope and the strategy travel together, because a host that took one without the other
 * still loses the page to the first remote it cannot reach (§30).
 */
export function hostFederation(options: HostSharedOptions): HostFederationOptions {
  return { shared: hostShared(options), shareStrategy: HOST_SHARE_STRATEGY }
}
