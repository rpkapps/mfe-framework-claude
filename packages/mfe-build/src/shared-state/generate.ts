import type { DiscoveredDefinition } from '../discovery/definitions.ts'
import type { StateNode, SharedStateManifest } from '@company/mfe-core/shared-state'
import { banner, generatedPath, jsonFile, type GeneratedFile } from '../generate/emit.ts'
import type { GenerateContext } from '../generate/modules.ts'
import { requirementsFor } from './compiler.ts'

export function stateType(node: StateNode): string {
  switch (node.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      return node.kind
    case 'literal':
      return JSON.stringify(node.value)
    case 'enum':
      return node.values.map(value => JSON.stringify(value)).join(' | ')
    case 'array':
      return `(${stateType(node.item)})[]`
    case 'nullable':
      return `${stateType(node.inner)} | null`
    case 'optional':
      return `${stateType(node.inner)} | undefined`
    case 'default':
      return `Exclude<${stateType(node.inner)}, undefined>`
    case 'object':
      return `{ ${Object.entries(node.fields)
        .map(
          ([key, field]) =>
            `${JSON.stringify(key)}${canBeOmitted(field) ? '?' : ''}: ${stateType(field)}`,
        )
        .join('; ')} }`
  }
}
function canBeOmitted(node: StateNode): boolean {
  return node.kind === 'optional' || (node.kind === 'nullable' && canBeOmitted(node.inner))
}
export function sharedStateFiles(context: GenerateContext): readonly GeneratedFile[] {
  const definitions = context.discovery.definitions.filter(
    (definition): definition is DiscoveredDefinition & { sharedState: SharedStateManifest } =>
      definition.sharedState !== undefined,
  )
  if (!definitions.length) return []
  if (!['react', 'angular'].includes(context.profile.framework))
    throw new Error('Shared-state bindings require a supported framework profile')
  const files: GeneratedFile[] = []
  const references = Object.fromEntries(
    definitions.map(definition => [definition.id, requirementsFor(definition.sharedState)]),
  )
  files.push({
    path: generatedPath(context.options.generatedDir, 'shared-state.references.json'),
    contents: jsonFile(references),
  })
  const emitted = new Set<string>()
  for (const definition of definitions) {
    const manifest = definition.sharedState
    const types = manifest.contracts
      .map(contract => `  ${JSON.stringify(contract.id)}: ${stateType(contract.node)}`)
      .join('\n')
    const react = context.profile.framework === 'react'
    files.push({
      path: generatedPath(context.options.generatedDir, `shared-state/${definition.id}.ts`),
      contents: [
        banner(context.profile.generator, `#mfe/shared-state/${definition.id}`),
        `import { createSharedStateBindings } from '@company/mfe-${context.profile.framework}/shared-state'`,
        `export interface SharedStateValues {\n${types}\n}`,
        `export type { SharedStateStore, SharedStateSetter } from '@company/mfe-${context.profile.framework}/shared-state'`,
        ...(react
          ? [
              `export type AppRouterOptions = import('@company/mfe-react').AppRouterOptions<SharedStateValues>`,
              `export type MfeRouterContext = import('@company/mfe-react').MfeRouterContext<SharedStateValues>`,
            ]
          : []),
        `export const { ${react ? 'useSharedState, useSharedStateStore' : 'injectSharedState, injectSharedStateStore'} } = createSharedStateBindings<SharedStateValues>(${JSON.stringify(definition.id)})`,
        '',
      ].join('\n'),
    })
    for (const contract of manifest.contracts) {
      if (emitted.has(contract.revision)) continue
      emitted.add(contract.revision)
      files.push({
        path: generatedPath(
          context.options.generatedDir,
          `shared-state/contracts/${contract.revision}.json`,
        ),
        contents: jsonFile(contract),
        asset: `shared-state/${contract.revision}.json`,
      })
    }
  }
  files.push({
    path: generatedPath(context.options.generatedDir, 'shared-state.manifest.json'),
    contents: jsonFile({
      formatVersion: 1,
      definitions: references,
      artifacts: [...emitted].sort().map(revision => `shared-state/${revision}.json`),
    }),
    asset: 'shared-state.manifest.json',
  })
  return files
}
