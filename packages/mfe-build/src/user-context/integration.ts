import { readFileSync } from 'node:fs'
import type { StateContract } from '@company/mfe-core/user-context'
import { createRequire } from 'node:module'
import { generatedPath } from '../generate/emit.ts'
import type { ContainerPlan } from '../plan.ts'
import { checkUserContextRelease, type UserContextReleasePolicy } from './compiler.ts'

/** Declared baselines are enforced in every build; a first release needs no central policy. */
export function checkUserContextBuild(plan: ContainerPlan, _production: boolean): void {
  for (const [ownerId, files] of Object.entries(plan.options.userContextBaselines ?? {})) {
    const definition = plan.discovery.definitions.find(candidate => candidate.id === ownerId)
    const owned = definition?.userContext?.contracts.find(contract => contract.id === ownerId)
    if (!owned)
      throw new Error(
        `user-context/missing-contract: No declared schema for baseline owner ${ownerId}`,
      )
    const schema = { formatVersion: 1 as const, contracts: [owned] }
    const baselines = files.map(file => {
      const artifact = JSON.parse(readFileSync(file, 'utf8')) as
        UserContextReleasePolicy['schema'] | StateContract
      const manifest =
        artifact && 'node' in artifact
          ? { formatVersion: artifact.formatVersion, contracts: [artifact] }
          : artifact
      const contract = manifest.contracts?.[0]
      if (
        manifest.formatVersion !== 1 ||
        !Array.isArray(manifest.contracts) ||
        manifest.contracts.length !== 1 ||
        contract?.id !== ownerId
      )
        throw new Error(
          `user-context/invalid-artifact: Baseline must contain one contract for ${ownerId}`,
        )
      return manifest
    })
    checkUserContextRelease([schema], { schema, baselines })
  }
}
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
