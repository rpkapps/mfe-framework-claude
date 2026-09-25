/** One synchronous pass over the container's sources, so it can be tested without a compiler. */

import { join } from 'node:path'

import type { CapabilityDescriptor, PublishedRoute } from '@company/mfe-core'

import { findNonContainerAwareAssetReferences } from './assets/relative-references.ts'
import { readConfigSource, type ConfigSource } from './config/config-source.ts'
import type { CapabilityOwner } from './discovery/capabilities.ts'
import { discoverDefinitions, type DiscoveryResult } from './discovery/definitions.ts'
import { resolveEntryModule } from './discovery/entry.ts'
import { collectRoutes } from './discovery/routes.ts'
import { createSourceCache, type ContainerSources } from './discovery/sources.ts'
import { containerSourceFiles, findStrayDefinitions } from './discovery/stray-definitions.ts'
import { adapterCarriedShares, resolveFrameworkScope } from './federation/framework-scope.ts'
import { installedVersionFrom } from './federation/installed-version.ts'
import {
  containerDependencies,
  resolveShared,
  shareScopesOf,
  sortedByName,
  withPagePolicy,
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
import { stylesheetPath } from './generate/styles.ts'
import { resolveOptions, type ContainerOptions, type ResolvedOptions } from './options.ts'
import type { ContainerProfile } from './profile.ts'

export interface ContainerPlan {
  readonly options: ResolvedOptions
  readonly entryFile: string
  readonly discovery: DiscoveryResult
  readonly capabilities: readonly CapabilityDescriptor[]
  /** The App's routes, sorted by path; empty for a Widget-only container. */
  readonly routes: readonly PublishedRoute[]
  readonly configSource: ConfigSource | undefined
  readonly shared: Readonly<Record<string, SharedModuleConfig>>
  /** Module Federation exposes: generated names, not public API. */
  readonly exposes: Readonly<Record<string, string>>
  /** The bundler entry, which a container has only because a bundler needs one. */
  readonly entryStub: string
  /** `#mfe/*` to the generated module each one resolves to. */
  readonly aliases: Readonly<Record<string, string>>
  /** The generated stylesheet every exposed entry imports. */
  readonly stylesheet: string
  /** The `data-mfe-scope` values this container's CSS is scoped to. */
  readonly scopes: readonly string[]
  /** Whether the stylesheet is compiled with Tailwind, or has its plain CSS imports inlined. */
  readonly tailwind: boolean
  readonly generated: GeneratedOutput
  /** Non-fatal findings the integration reports on the compilation. */
  readonly diagnostics: readonly Error[]
}

/** Reads the container and derives everything the build needs from it. */
export function planContainer(
  profile: ContainerProfile,
  options: ContainerOptions = {},
): ContainerPlan {
  return createContainerPlanner(profile, options)()
}

/**
 * Plans the container on every call. What cannot change without a restart — the options its
 * manifest settles, what it shares and in which scopes — is read by the first call alone, because
 * it walks `node_modules`; each call re-reads only the sources, and parses only the files that
 * changed since the call before.
 */
export function createContainerPlanner(
  profile: ContainerProfile,
  options: ContainerOptions = {},
): () => ContainerPlan {
  const settled = resolveOptions(options, profile.containerRootOption)
  const nextSources = createSourceCache()
  let shares: Shares | undefined

  return () => {
    // The time is the one option a restart does not settle: a shape that changes while watching
    // records when it changed.
    const resolved = settled.buildTimeFixed
      ? settled
      : { ...settled, buildTime: new Date().toISOString() }
    return planSources(profile, resolved, nextSources(), () => {
      shares ??= planShares(profile, settled)
      return shares
    })
  }
}

interface Shares {
  readonly shared: Readonly<Record<string, SharedModuleConfig>>
  /** The share scopes a host registers this container with, `default` first. */
  readonly shareScopes: readonly string[]
}

/**
 * `shares` is read where a failure to resolve them has always been reported: after the sources,
 * so a container that is wrong in both ways is told about its sources first.
 */
function planSources(
  profile: ContainerProfile,
  resolved: ResolvedOptions,
  sources: ContainerSources,
  shares: () => Shares,
): ContainerPlan {
  const sourceRoot = join(resolved.containerRoot, 'src')

  const entryFile = resolveEntryModule(resolved.containerRoot, profile.definitions)
  const discovery = discoverDefinitions(entryFile, profile.definitions, sources)
  const configSource = readConfigSource(resolved.containerRoot, profile.envModules, sources)
  const sourceFiles = containerSourceFiles(sourceRoot, new Set([resolved.generatedDir]))

  const owner: CapabilityOwner = {
    hasApp: discovery.app !== undefined,
    ...(discovery.app === undefined ? {} : { appId: discovery.app.id }),
  }
  const readContext = {
    containerRoot: resolved.containerRoot,
    entryFile,
    discovery,
    owner,
    sourceFiles,
    sources,
  }
  const capabilities = profile.readCapabilities?.(readContext) ?? []
  // A Widget owns no URL, so a container without an App publishes no routes.
  const routes =
    discovery.app === undefined ? [] : collectRoutes(profile.readRoutes?.(readContext) ?? [])

  const { shared, shareScopes } = shares()

  const context: GenerateContext = {
    options: resolved,
    entryFile,
    discovery,
    configSource,
    profile,
    shareScopes,
  }

  const generated = generateContainerFiles(context, capabilities, routes)

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
    routes,
    configSource,
    shared,
    exposes,
    entryStub: containerEntryPath(context),
    aliases,
    stylesheet: stylesheetPath(context),
    scopes: discovery.definitions.map(definition => definition.id),
    tailwind: profile.stylesheet.tailwind !== false,
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

function planShares(profile: ContainerProfile, resolved: ResolvedOptions): Shares {
  const shared = planShared(profile, resolved)
  return { shared, shareScopes: shareScopesOf(shared) }
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
  const policy = withPagePolicy(profile.sharing)

  const own = resolveShared({
    policy,
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
    policy,
  })

  return sortedByName({ ...carried, ...own })
}
