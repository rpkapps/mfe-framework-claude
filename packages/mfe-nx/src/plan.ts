/** One synchronous pass over the container's sources, so it can be tested without a compiler. */

import { resolve } from 'node:path'

import { planContainer as planBuildContainer, type ContainerPlan } from '@company/mfe-build'

import { assertShareable } from './federation/sharing.ts'
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

  return planBuildContainer(angularProfile(), { ...options, containerRoot })
}
