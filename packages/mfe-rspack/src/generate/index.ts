/**
 * The build hash is a content hash of the generated files, so it is computed in
 * two steps: everything else first, then the two files that carry it.
 */

import type { CapabilityDescriptor, ContainerDescriptor } from '@company/mfe-core'

import {
  containerDescriptor,
  envExampleFile,
  frameworkMetadata,
  gitignoreFile,
  registryDescriptorFile,
  runtimeConfigSchemaFile,
  tsconfigPathsFile,
  type FrameworkManifestMetadata,
} from './artifacts.ts'
import { contentHash, type GeneratedFile } from './emit.ts'
import {
  configModule,
  federationEntryModules,
  fetchModule,
  metaModule,
  widgetContractModules,
  type GenerateContext,
} from './modules.ts'

export interface GeneratedOutput {
  readonly files: readonly GeneratedFile[]
  readonly buildHash: string
  readonly descriptor: ContainerDescriptor
  readonly frameworkMetadata: FrameworkManifestMetadata
}

export function generateContainerFiles(
  context: GenerateContext,
  capabilities: readonly CapabilityDescriptor[],
): GeneratedOutput {
  const base: GeneratedFile[] = [
    gitignoreFile(context),
    tsconfigPathsFile(context),
    fetchModule(context),
    ...federationEntryModules(context),
    ...widgetContractModules(context),
  ]

  const config = configModule(context)
  if (config !== null) base.push(config)

  const schema = runtimeConfigSchemaFile(context)
  if (schema !== null) base.push(schema)

  const envExample = envExampleFile(context)
  if (envExample !== null) base.push(envExample)

  const buildHash = contentHash(base, context.options.generatedDir)
  const descriptor = containerDescriptor(context, capabilities, buildHash)

  const files = [
    ...base,
    metaModule(context, buildHash),
    registryDescriptorFile(context, descriptor),
  ]

  return {
    files: [...files].sort((left, right) => (left.path < right.path ? -1 : 1)),
    buildHash,
    descriptor,
    frameworkMetadata: frameworkMetadata(context, descriptor, buildHash),
  }
}
