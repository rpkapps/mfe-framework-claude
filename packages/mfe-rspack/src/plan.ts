/** One synchronous pass over the container's sources, so it can be tested without a compiler. */

import { resolve } from 'node:path'

import {
  planContainer as planBuildContainer,
  type ContainerPlan as BuildContainerPlan,
} from '@company/mfe-build'

import { resolveReactOptions, type MfePluginOptions, type ResolvedOptions } from './options.ts'
import { reactProfile } from './profile.ts'

export interface ContainerPlan extends BuildContainerPlan {
  readonly options: ResolvedOptions
}

export interface PlanContainerOptions extends MfePluginOptions {
  /** Fallback container root when the options do not name one. */
  readonly defaultRoot?: string
}

/** Reads the container and derives everything the build needs from it. */
export function planContainer(options: PlanContainerOptions = {}): ContainerPlan {
  const containerRoot = resolve(options.containerRoot ?? options.defaultRoot ?? process.cwd())
  const react = resolveReactOptions(options, containerRoot)

  const plan = planBuildContainer(reactProfile(react), { ...options, containerRoot })
  return { ...plan, options: { ...plan.options, ...react } }
}
