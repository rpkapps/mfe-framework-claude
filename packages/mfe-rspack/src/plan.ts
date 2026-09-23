/** One synchronous pass over the container's sources, so it can be tested without a compiler. */

import { resolve } from 'node:path'

import {
  createContainerPlanner as createBuildPlanner,
  type ContainerPlan as BuildContainerPlan,
} from '@company/mfe-build'

import { resolveReactOptions, type MfePluginOptions, type ResolvedOptions } from './options.ts'
import { reactProfile } from './profile.ts'

export interface ContainerPlan extends BuildContainerPlan {
  readonly options: ResolvedOptions
}

/** Reads the container and derives everything the build needs from it. */
export function planContainer(options: MfePluginOptions = {}): ContainerPlan {
  return createContainerPlanner(options)()
}

/** `mfe-build`'s planner, with the React options settled once alongside the rest. */
export function createContainerPlanner(options: MfePluginOptions = {}): () => ContainerPlan {
  const containerRoot = resolve(options.containerRoot ?? process.cwd())
  const react = resolveReactOptions(options, containerRoot)
  const plan = createBuildPlanner(reactProfile(react), { ...options, containerRoot })

  return () => {
    const planned = plan()
    return { ...planned, options: { ...planned.options, ...react } }
  }
}
