/**
 * The federation options a *host* declares: its share scope, and how shares in
 * it are resolved.
 *
 * A host is not a container, but it joins the same share scope every container
 * on the page joins — and that is the one thing two hand-written lists cannot
 * be relied on to keep in step, because a disagreement is silent until a remote
 * mounts and a framework hook fails inside it. So the policy lives here once:
 * the same candidates and the same singleton and eager rules `pluginMfe()`
 * gives a container, against the host's own install.
 *
 * This is deliberately the whole host-facing surface. A host's entry, document,
 * dev server and define plugin are its own.
 */

import { join } from 'node:path'

import { createBuildError } from '../diagnostics.ts'

import { installedVersionFrom } from './installed-version.ts'
import {
  DEFAULT_SHARED_CANDIDATES,
  packageOf,
  resolveShared,
  type SharedModuleConfig,
} from './sharing.ts'

export type { SharedModuleConfig } from './sharing.ts'

export interface HostSharedOptions {
  /**
   * The host's root: the directory holding its package.json, which is what
   * every candidate is resolved from. In an Rsbuild config that is the
   * directory the config file sits in.
   */
  readonly root: string
  /**
   * The version a package resolved to in the host's install. Injected so the
   * policy can be exercised without one; defaults to reading `root`.
   */
  readonly installedVersion?: (name: string) => string | undefined
}

/**
 * The `shared` map for a host's `moduleFederation.options`.
 *
 * Two things differ from the container side, both because a host *provides* the
 * modules rather than consuming them. It advertises the version it installed,
 * never the range it declared: the share scope describes the copy it is putting
 * in, and a remote's check has to be against that. And it shares what it can
 * resolve, not what it lists — `@company/mfe-core` reaches a shell through the
 * adapter and is never a dependency, while a candidate that resolves nowhere is
 * one this host has no copy of and cannot serve.
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

  // Resolving none of them means the root is not where this host's modules
  // are: the symptom would be every remote quietly loading its own React.
  // Individual absences stay legal, which is what makes the total worth
  // reporting.
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

  // `resolveShared` keeps a candidate only where this map has an entry and
  // reads the requirement from it, so the installed version does both jobs.
  return resolveShared({ dependencies: installed, installedVersion })
}

/**
 * How the host resolves a share once its remotes are registered.
 *
 * Module Federation's default, `version-first`, re-initialises **every**
 * registered remote before resolving any share: each `loadShare` awaits every
 * remote's manifest so the highest compatible version can win. One unreachable
 * manifest therefore rejects the host's own share resolution — not that
 * remote's, the host's — so the next chunk the shell loads after a dead remote
 * was registered fails to resolve `react`, `@tecton/react/*` or the framework
 * packages, and a chrome that had been running comes down with it. A registry
 * is assembled from builds the host does not control, so one entry being
 * unreachable is normal and must cost that entry alone.
 *
 * `loaded-first` resolves against the scope as it stands, so a registered
 * remote is contacted only when something actually loads from it. It also
 * settles the second half of the same question: a share the host provides is
 * no longer replaced in the scope by a remote's copy of that module, so the
 * shell renders the design system it was built against even when a container
 * on the page was built against another version of it.
 */
const HOST_SHARE_STRATEGY = 'loaded-first' as const

/** The federation options a host hands `moduleFederation.options`, whole. */
export interface HostFederationOptions {
  readonly shared: Readonly<Record<string, SharedModuleConfig>>
  readonly shareStrategy: typeof HOST_SHARE_STRATEGY
}

/**
 * The share scope and the resolution strategy together, because they are one
 * policy: a host that took the scope and left the strategy would share the
 * right modules and still lose the page to the first remote it cannot reach.
 */
export function hostFederation(options: HostSharedOptions): HostFederationOptions {
  return { shared: hostShared(options), shareStrategy: HOST_SHARE_STRATEGY }
}
