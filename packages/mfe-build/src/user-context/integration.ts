import { createRequire } from 'node:module'
import { generatedPath } from '../generate/emit.ts'
import type { ContainerPlan } from '../plan.ts'

export function userContextTransformRule(plan: ContainerPlan, stage: 'pre' | 'post' = 'pre') {
  if (!plan.discovery.definitions.some(definition => definition.userContext)) return undefined
  return {
    include: [plan.entryFile],
    enforce: stage,
    use: [
      {
        loader: createRequire(import.meta.url).resolve('@company/mfe-build/user-context-loader'),
        options: {
          references: generatedPath(plan.options.generatedDir, 'user-context.references.json'),
        },
      },
    ],
  }
}
