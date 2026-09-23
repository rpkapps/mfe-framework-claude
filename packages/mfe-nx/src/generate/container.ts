/** The generation step, shared by the build and the `generate` executor so neither can drift. */

import { writeGeneratedFiles, type ContainerPlan, type GeneratedFile } from '@company/mfe-build'

import type { MfeAngularOptions } from '../options.ts'
import { planContainer } from '../plan.ts'

export interface ContainerGeneration {
  readonly plan: ContainerPlan
  /** The files whose contents changed; an unchanged file is left untouched. */
  readonly written: readonly GeneratedFile[]
}

/** Re-reads the container's sources and rewrites what changed. */
export function generateContainer(options: MfeAngularOptions = {}): ContainerGeneration {
  const plan = planContainer(options)
  return { plan, written: writeGeneratedFiles(plan.generated.files) }
}
