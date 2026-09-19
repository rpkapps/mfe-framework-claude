/**
 * The build hash is a content hash of the generated files, so it is computed in
 * two steps: everything else first, then the two files that carry it.
 */

import { readFileSync } from 'node:fs'

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
    containerEntryModule(context),
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

  // The two files below are the only ones carrying a time, so they are the only
  // ones built against the recorded one.
  const recorded: GenerateContext = {
    ...context,
    options: { ...context.options, buildTime: recordedBuildTime(context, buildHash) },
  }
  const descriptor = containerDescriptor(recorded, capabilities, buildHash)

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
 * The time recorded against this shape, which is deliberately not the time of
 * this compilation.
 *
 * A watching build regenerates before every compilation. A time that advanced
 * each time would rewrite `meta.ts` and the registry descriptor every time —
 * and `meta.ts` is a module the container imports, so writing it is a source
 * change, so the watcher starts the next compilation, which writes it again.
 * The container rebuilds forever; the page's hot updates chase a build hash
 * that is stale before the request lands; the dev server gives up and reloads
 * the page. It reads as "hot updates don't work in this framework" and it is
 * the build editing its own input.
 *
 * So the recorded time advances with the build hash and not otherwise: an
 * unchanged shape keeps the time already on disk and regenerates byte for byte,
 * which is also what makes `writeGeneratedFiles` able to skip it. A caller that
 * fixed the time — a reproducible build, a test — gets exactly that time.
 */
function recordedBuildTime(context: GenerateContext, buildHash: string): string {
  if (context.options.buildTimeFixed) return context.options.buildTime

  const previous = readPreviousBuild(context)
  return previous !== null && previous.hash === buildHash
    ? previous.time
    : context.options.buildTime
}

/**
 * What the last generation recorded, read back from the descriptor it wrote.
 * Anything unreadable, or written by something other than this generator,
 * reads as no previous build rather than as an error: the only thing at stake
 * is whether a time is carried forward.
 */
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
