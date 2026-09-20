/**
 * The share scope a federation *host* declares.
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
        "Pass hostShared({ root }) the directory holding the host's package.json — in an Rsbuild config, dirname(fileURLToPath(import.meta.url)) — and install its dependencies.",
    })
  }

  // `resolveShared` keeps a candidate only where this map has an entry and
  // reads the requirement from it, so the installed version does both jobs.
  return resolveShared({ dependencies: installed, installedVersion })
}
