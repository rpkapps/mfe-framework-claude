/** One synchronous pass over the container's sources, so it can be tested without a compiler. */

import { resolve } from 'node:path'

import {
  createContainerPlanner as createBuildPlanner,
  type ContainerPlan,
} from '@company/mfe-build'

import { assertShareable } from './federation/sharing.ts'
import type { MfeAngularOptions } from './options.ts'
import { angularProfile } from './profile.ts'

/** Reads the container and derives everything the build needs from it. */
export function planContainer(options: MfeAngularOptions = {}): ContainerPlan {
  return createContainerPlanner(options)()
}

/** `mfe-build`'s planner, after refusing a share no Angular container may add. */
export function createContainerPlanner(options: MfeAngularOptions = {}): () => ContainerPlan {
  const containerRoot = resolve(options.containerRoot ?? process.cwd())
  assertShareable(options.shared ?? {}, containerRoot)

  return createBuildPlanner(angularProfile(), { ...options, containerRoot })
}
