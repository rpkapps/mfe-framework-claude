import type { DiscoveredDefinition } from '../discovery/definitions.ts'
import type { StateNode, UserContextManifest } from '@company/mfe-core/user-context'
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
export function userContextFiles(context: GenerateContext): readonly GeneratedFile[] {
  const definitions = context.discovery.definitions.filter(
    (definition): definition is DiscoveredDefinition & { userContext: UserContextManifest } =>
      definition.userContext !== undefined,
  )
  if (!definitions.length) return []
  if (!['react', 'angular'].includes(context.profile.framework))
    throw new Error('User-context bindings require a supported framework profile')
  const files: GeneratedFile[] = []
  const references = Object.fromEntries(
    definitions.map(definition => [
      definition.id,
      requirementsFor(definition.userContext, definition.id),
    ]),
  )
  files.push({
    path: generatedPath(context.options.generatedDir, 'user-context.references.json'),
    contents: jsonFile(references),
  })
  const emitted = new Set<string>()
  for (const definition of definitions) {
    const manifest = definition.userContext
    const owner = manifest.contracts.find(contract => contract.id === definition.id)
    const types = owner ? stateType(owner.node) : 'Record<string, never>'
    const react = context.profile.framework === 'react'
    files.push({
      path: generatedPath(context.options.generatedDir, `user-context/${definition.id}.ts`),
      contents: [
        banner(context.profile.generator, `#mfe/user-context/${definition.id}`),
        `import { createUserContextBindings } from '@company/mfe-${context.profile.framework}/user-context'`,
        `export type UserContextValues = ${types}`,
        `export type { UserContextReader, UserContextStore, UserContextSetter } from '@company/mfe-${context.profile.framework}/user-context'`,
        ...(react
          ? [
              `export type AppRouterOptions = import('@company/mfe-react').AppRouterOptions<UserContextValues>`,
              `export type MfeRouterContext = import('@company/mfe-react').MfeRouterContext<UserContextValues>`,
            ]
          : []),
        `export const { ${react ? 'useUserContext, useUserContextStore' : 'injectUserContext, injectUserContextStore'} } = createUserContextBindings<UserContextValues>(${JSON.stringify(definition.id)})`,
        '',
      ].join('\n'),
    })
    for (const contract of manifest.contracts) {
      if (emitted.has(contract.revision)) continue
      emitted.add(contract.revision)
      files.push({
        path: generatedPath(
          context.options.generatedDir,
          `user-context/contracts/${contract.revision}.json`,
        ),
        contents: jsonFile(contract),
        asset: `user-context/${contract.revision}.json`,
      })
    }
  }
  files.push({
    path: generatedPath(context.options.generatedDir, 'user-context.manifest.json'),
    contents: jsonFile({
      formatVersion: 1,
      definitions: references,
      artifacts: [...emitted].sort().map(revision => `user-context/${revision}.json`),
    }),
    asset: 'user-context.manifest.json',
  })
  return files
}
