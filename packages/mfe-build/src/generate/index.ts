/** The build hash is a content hash of the generated files, so the two carrying it come last. */

import { readFileSync } from 'node:fs'

import type { CapabilityDescriptor, PublishedRoute, ContainerDescriptor } from '@company/mfe-core'

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
import { contentHash, generatedPath, type GeneratedFile } from './emit.ts'
import {
  configModule,
  containerEntryModule,
  federationEntryModules,
  fetchModule,
  metaModule,
  widgetContractModules,
  type GenerateContext,
} from './modules.ts'
import { runtimeConfigDefaultsFile, runtimeConfigScriptFile } from './runtime-config.ts'
import { cssModuleTypes, stylesheetFile } from './styles.ts'

export interface GeneratedOutput {
  readonly files: readonly GeneratedFile[]
  readonly buildHash: string
  readonly descriptor: ContainerDescriptor
  readonly frameworkMetadata: FrameworkManifestMetadata
}

export function generateContainerFiles(
  context: GenerateContext,
  capabilities: readonly CapabilityDescriptor[],
  routes: readonly PublishedRoute[] = [],
): GeneratedOutput {
  const base: GeneratedFile[] = [
    gitignoreFile(context),
    tsconfigPathsFile(context),
    cssModuleTypes(context),
    stylesheetFile(context),
    fetchModule(context),
    containerEntryModule(context),
    ...federationEntryModules(context),
    ...widgetContractModules(context),
    ...(context.profile.generatedFiles?.(context) ?? []),
  ]

  const config = configModule(context)
  if (config !== null) base.push(config)

  const schema = runtimeConfigSchemaFile(context)
  if (schema !== null) base.push(schema)

  const envExample = envExampleFile(context)
  if (envExample !== null) base.push(envExample)

  const defaults = runtimeConfigDefaultsFile(context)
  if (defaults !== null) base.push(defaults)

  const script = runtimeConfigScriptFile(context)
  if (script !== null) base.push(script)

  const buildHash = contentHash(base, context.options.generatedDir)

  // These two are the only files carrying a time, so only they are built against it.
  const recorded: GenerateContext = {
    ...context,
    options: { ...context.options, buildTime: recordedBuildTime(context, buildHash) },
  }
  const descriptor = containerDescriptor(recorded, capabilities, buildHash, routes)

  const files = [
    ...base,
    metaModule(recorded, buildHash),
    registryDescriptorFile(recorded, descriptor),
  ]

  return {
    files: [...files].sort((left, right) => (left.path < right.path ? -1 : 1)),
    buildHash,
    descriptor,
    frameworkMetadata: frameworkMetadata(recorded, descriptor, buildHash),
  }
}

/**
 * Deliberately not this compilation's time: `meta.ts` is a module the container imports, so a
 * time that advanced every regeneration would have a watching build rewrite its own input (§19).
 */
function recordedBuildTime(context: GenerateContext, buildHash: string): string {
  if (context.options.buildTimeFixed) return context.options.buildTime

  const previous = readPreviousBuild(context)
  return previous !== null && previous.hash === buildHash
    ? previous.time
    : context.options.buildTime
}

/** Anything unreadable reads as no previous build; only a carried-forward time is at stake. */
function readPreviousBuild(context: GenerateContext): { hash: string; time: string } | null {
  const path = generatedPath(context.options.generatedDir, context.options.registryFileName)

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const build: unknown = (parsed as { build?: unknown }).build
  if (typeof build !== 'object' || build === null) return null

  const { hash, time } = build as { hash?: unknown; time?: unknown }
  return typeof hash === 'string' && typeof time === 'string' ? { hash, time } : null
}
