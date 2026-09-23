/** One synchronous pass over the container's sources, so it can be tested without a compiler. */

import { join } from 'node:path'

import type { CapabilityDescriptor, DefinitionFramework } from '@company/mfe-core'

import { readConfigSource, type ConfigSource } from './config/config-source.ts'
import { extractCapabilities, extractRouteDataCapabilities } from './discovery/capabilities.ts'
import { discoverDefinitions, type DiscoveryResult } from './discovery/definitions.ts'
import { resolveEntryModule } from './discovery/entry.ts'
import {
  containerSourceFiles,
  findStrayDefinitions,
  isTestFile,
} from './discovery/stray-definitions.ts'
import { installedVersionFrom } from './federation/installed-version.ts'
import {
  containerDependencies,
  resolveShared,
  type SharedModuleConfig,
} from './federation/sharing.ts'
import { generateContainerFiles, type GeneratedOutput } from './generate/index.ts'
import { generatedPath } from './generate/emit.ts'
import {
  ALIASES,
  containerEntryPath,
  entryModulePath,
  exposeName,
  type GenerateContext,
} from './generate/modules.ts'
import { findNonContainerAwareAssetReferences } from './assets/relative-references.ts'
import {
  assertOptionsApply,
  resolveOptions,
  type MfePluginOptions,
  type ResolvedOptions,
} from './options.ts'

export interface ContainerPlan {
  readonly options: ResolvedOptions
  /** The adapter that builds, shares and mounts this container, from where its entry imports. */
  readonly framework: DefinitionFramework
  readonly entryFile: string
  readonly discovery: DiscoveryResult
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly configSource: ConfigSource | undefined
  readonly shared: Readonly<Record<string, SharedModuleConfig>>
  /** Module Federation exposes: generated names, not public API. */
  readonly exposes: Readonly<Record<string, string>>
  /** The bundler entry, which a container has only because a bundler needs one. */
  readonly entryStub: string
  /** `#mfe/*` to the generated module each one resolves to. */
  readonly aliases: Readonly<Record<string, string>>
  /** The `data-mfe-scope` values this container's CSS is scoped to. */
  readonly scopes: readonly string[]
  readonly generated: GeneratedOutput
  /** Non-fatal findings the plugin reports on the compilation. */
  readonly diagnostics: readonly Error[]
}

export interface PlanContainerOptions extends MfePluginOptions {
  /** Fallback container root when the options do not name one. */
  readonly defaultRoot?: string
}

/** Reads the container and derives everything the build needs from it. */
export function planContainer(options: PlanContainerOptions = {}): ContainerPlan {
  const resolved = resolveOptions(options, options.defaultRoot ?? process.cwd())

  const sourceRoot = join(resolved.containerRoot, 'src')
  const generatedDir = resolved.generatedDir

  const entryFile = resolveEntryModule(resolved.containerRoot)
  const discovery = discoverDefinitions(entryFile)
  const { framework } = discovery
  assertOptionsApply(options, framework, entryFile)
  const configSource = readConfigSource(resolved.containerRoot)
  const sourceFiles = containerSourceFiles(sourceRoot, new Set([generatedDir]))

  const owner = {
    hasApp: discovery.app !== undefined,
    ...(discovery.app === undefined ? {} : { appId: discovery.app.id }),
  }
  const capabilities =
    framework === 'angular'
      ? extractRouteDataCapabilities({
          ...owner,
          entryFile,
          sourceFiles: sourceFiles.filter(file => !isTestFile(file)),
        })
      : extractCapabilities({ ...owner, routesDirectory: resolved.routesDirectory })

  const context: GenerateContext = {
    options: resolved,
    entryFile,
    discovery,
    configSource,
  }

  const generated = generateContainerFiles(context, capabilities)

  const exposes: Record<string, string> = {}
  for (const definition of discovery.definitions) {
    exposes[exposeName(definition)] = entryModulePath(context, definition)
  }

  // The platform's own separator: these are paths the bundler resolves, not module specifiers.
  const aliases: Record<string, string> = {
    [ALIASES.fetch]: generatedPath(resolved.generatedDir, 'fetch.ts'),
    [ALIASES.meta]: generatedPath(resolved.generatedDir, 'meta.ts'),
  }
  if (configSource !== undefined) {
    aliases[ALIASES.config] = generatedPath(resolved.generatedDir, 'config.ts')
  }

  return {
    options: resolved,
    framework,
    entryFile,
    discovery,
    capabilities,
    configSource,
    shared: resolveShared({
      framework,
      dependencies: containerDependencies(resolved),
      overrides: resolved.sharedOverrides,
      installedVersion: installedVersionFrom(resolved.containerRoot),
    }),
    exposes,
    entryStub: containerEntryPath(context),
    aliases,
    scopes: discovery.definitions.map(definition => definition.id),
    generated,
    diagnostics: [
      ...findStrayDefinitions(sourceRoot, { entryFile, ignoredDirectories: [generatedDir] }),
      ...sourceFiles.flatMap(file => findNonContainerAwareAssetReferences(file)),
    ],
  }
}
