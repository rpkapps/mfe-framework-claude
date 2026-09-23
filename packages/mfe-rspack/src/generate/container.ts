/** The generation step, shared by the build and `mfe-generate` so neither can drift. */

import { writeGeneratedFiles, type GeneratedFile } from '@company/mfe-build'

import { planContainer, type ContainerPlan, type PlanContainerOptions } from '../plan.ts'

export interface ContainerGeneration {
  readonly plan: ContainerPlan
  /** The files whose contents changed; an unchanged file is left untouched. */
  readonly written: readonly GeneratedFile[]
}

/** Re-reads the container's sources and rewrites what changed. */
export function generateContainer(options: PlanContainerOptions = {}): ContainerGeneration {
  const plan = planContainer(options)
  return { plan, written: writeGeneratedFiles(plan.generated.files) }
}
