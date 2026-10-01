import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { generatedPath } from '../generate/emit.ts'
import type { ContainerPlan } from '../plan.ts'
import { checkSharedStateRelease, type SharedStateReleasePolicy } from './compiler.ts'

/** Every bundler uses the same policy and declaration transform; watch reads fresh references. */
export function checkSharedStateBuild(plan: ContainerPlan, production: boolean): void {
  const manifests = plan.discovery.definitions.flatMap(definition =>
    definition.sharedState ? [definition.sharedState] : [],
  )
  if (!manifests.length) return
  const file = plan.options.sharedStatePolicy
  if (!file) {
    if (production)
      throw new Error(
        'shared-state/missing-baseline: Production builds require sharedStatePolicy with explicit baselines, catalog and supported revisions; use baselines: [] only for a first release',
      )
    return
  }
  const policy = JSON.parse(readFileSync(file, 'utf8')) as SharedStateReleasePolicy
  checkSharedStateRelease(manifests, policy)
}
export function sharedStateTransformRule(plan: ContainerPlan) {
  if (!plan.discovery.definitions.some(definition => definition.sharedState)) return undefined
  return {
    include: [plan.entryFile],
    enforce: 'pre' as const,
    use: [
      {
        loader: createRequire(import.meta.url).resolve('@company/mfe-build/shared-state-loader'),
        options: {
          references: generatedPath(plan.options.generatedDir, 'shared-state.references.json'),
        },
      },
    ],
  }
}
