/** One synchronous pass over the container's sources, so it can be tested without a compiler. */

import { join } from 'node:path'

import type { CapabilityDescriptor } from '@company/mfe-core'

import { findNonContainerAwareAssetReferences } from './assets/relative-references.ts'
import { readConfigSource, type ConfigSource } from './config/config-source.ts'
import type { CapabilityOwner } from './discovery/capabilities.ts'
import { discoverDefinitions, type DiscoveryResult } from './discovery/definitions.ts'
import { resolveEntryModule } from './discovery/entry.ts'
import { standaloneSources } from './discovery/sources.ts'
import { containerSourceFiles, findStrayDefinitions } from './discovery/stray-definitions.ts'
import { adapterCarriedShares, resolveFrameworkScope } from './federation/framework-scope.ts'
import { installedVersionFrom } from './federation/installed-version.ts'
import {
  containerDependencies,
  resolveShared,
  shareScopesOf,
  sortedByName,
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
import { resolveOptions, type ContainerOptions, type ResolvedOptions } from './options.ts'
import type { ContainerProfile } from './profile.ts'

export interface ContainerPlan {
  readonly options: ResolvedOptions
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
  /** Non-fatal findings the integration reports on the compilation. */
  readonly diagnostics: readonly Error[]
}

export interface PlanContainerOptions extends ContainerOptions {
  /** Fallback container root when the options do not name one. */
  readonly defaultRoot?: string
}

/** Reads the container and derives everything the build needs from it. */
export function planContainer(
  profile: ContainerProfile,
  options: PlanContainerOptions = {},
): ContainerPlan {
  const resolved = resolveOptions(
    options,
    options.defaultRoot ?? process.cwd(),
    profile.containerRootOption,
  )

  const sourceRoot = join(resolved.containerRoot, 'src')
  const generatedDir = resolved.generatedDir

  // Every reader below shares one read and one parse of each file.
  const sources = standaloneSources()

  const entryFile = resolveEntryModule(resolved.containerRoot, profile.definitions)
  const discovery = discoverDefinitions(entryFile, profile.definitions, sources)
  const configSource = readConfigSource(resolved.containerRoot, profile.envModules, sources)
  const sourceFiles = containerSourceFiles(sourceRoot, new Set([generatedDir]))

  const owner: CapabilityOwner = {
    hasApp: discovery.app !== undefined,
    ...(discovery.app === undefined ? {} : { appId: discovery.app.id }),
  }
  const capabilities =
    profile.readCapabilities?.({
      containerRoot: resolved.containerRoot,
      entryFile,
      discovery,
      owner,
      sourceFiles,
      sources,
    }) ?? []

  const shared = planShared(profile, resolved)

  const context: GenerateContext = {
    options: resolved,
    entryFile,
    discovery,
    configSource,
    profile,
    shareScopes: shareScopesOf(shared),
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
    entryFile,
    discovery,
    capabilities,
    configSource,
    shared,
    exposes,
    entryStub: containerEntryPath(context),
    aliases,
    scopes: discovery.definitions.map(definition => definition.id),
    generated,
    diagnostics: [
      ...findStrayDefinitions(sourceRoot, {
        entryFile,
        factoryModules: profile.definitions.factoryModules,
        sourceFiles,
        sources,
      }),
      ...sourceFiles.flatMap(file => findNonContainerAwareAssetReferences(file, sources)),
    ],
  }
}

/**
 * The container's own candidates, plus the page singletons its adapter carries in. The
 * container's own entry wins: one it depends on directly, or one its author added.
 */
function planShared(
  profile: ContainerProfile,
  resolved: ResolvedOptions,
): Readonly<Record<string, SharedModuleConfig>> {
  const root = resolved.containerRoot
  const installedVersion = installedVersionFrom(root)

  const own = resolveShared({
    policy: profile.sharing,
    dependencies: containerDependencies(resolved),
    overrides: resolved.sharedOverrides,
    installedVersion,
    frameworkScope: resolveFrameworkScope({
      framework: profile.framework,
      anchor: profile.frameworkAnchor,
      root,
      installedVersion,
    }),
  })
  const carried = adapterCarriedShares({
    adapter: profile.adapterModule,
    containerRoot: root,
    policy: profile.sharing,
  })

  return sortedByName({ ...carried, ...own })
}
