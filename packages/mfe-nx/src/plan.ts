/** One synchronous pass over the container's sources, so it can be tested without a compiler. */

import { resolve } from 'node:path'

import {
  planContainer as planBuildContainer,
  type ContainerPlan,
  type SharedModuleConfig,
} from '@company/mfe-build'

import { adapterCarriedShares, assertShareable } from './federation/sharing.ts'
import type { MfeAngularOptions } from './options.ts'
import { angularProfile } from './profile.ts'

export interface PlanContainerOptions extends MfeAngularOptions {
  /** Fallback container root when the options do not name one. */
  readonly defaultRoot?: string
}

/** Reads the container and derives everything the build needs from it. */
export function planContainer(options: PlanContainerOptions = {}): ContainerPlan {
  const containerRoot = resolve(options.containerRoot ?? options.defaultRoot ?? process.cwd())
  assertShareable(options.shared ?? {}, containerRoot)

  const plan = planBuildContainer(angularProfile(), { ...options, containerRoot })

  // The container's own entries win: one it depends on directly, or one its author added.
  return {
    ...plan,
    shared: sortedByName({ ...adapterCarriedShares(containerRoot), ...plan.shared }),
  }
}

/** The same order the neutral build writes, so the federation options are stable between builds. */
function sortedByName(
  shared: Readonly<Record<string, SharedModuleConfig>>,
): Readonly<Record<string, SharedModuleConfig>> {
  return Object.fromEntries(
    Object.entries(shared).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  )
}
