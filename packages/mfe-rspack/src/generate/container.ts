/**
 * The generation step, separated from the compiler that usually triggers it.
 *
 * A build runs this on every compilation and `mfe-generate` runs it on its own,
 * so a clone has its editor declarations before anything is bundled. One
 * function rather than two call sites: a second implementation would drift, and
 * only one of them would be the one CI ran.
 */

import { planContainer, type ContainerPlan, type PlanContainerOptions } from '../plan.ts'
import { writeGeneratedFiles, type GeneratedFile } from './emit.ts'

export interface ContainerGeneration {
  readonly plan: ContainerPlan
  /** The files whose contents changed. An unchanged file is left untouched. */
  readonly written: readonly GeneratedFile[]
}

/** Re-reads the container's sources and rewrites what changed. */
export function generateContainer(options: PlanContainerOptions = {}): ContainerGeneration {
  const plan = planContainer(options)
  return { plan, written: writeGeneratedFiles(plan.generated.files) }
}
