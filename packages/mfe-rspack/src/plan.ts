/**
 * The container plan.
 *
 * Everything the plugin needs to configure a build is derived here, in one
 * synchronous pass over the container's own sources: what it exports, what it
 * advertises, what it shares, what gets generated and what the Module
 * Federation manifest will say about it.
 *
 * It is a plain function on purpose. The plugin wires a compiler; this decides
 * what the compiler is being asked to do, and can be tested without one.
 */

import type { CapabilityDescriptor } from '@company/mfe-core'

import { readConfigSource, type ConfigSource } from './config/config-source.ts'
import { extractCapabilities } from './discovery/capabilities.ts'
import { discoverDefinitions, type DiscoveryResult } from './discovery/definitions.ts'
import { resolveEntryModule } from './discovery/entry.ts'
import { findStrayDefinitions } from './discovery/stray-definitions.ts'
import { containerDependencies, resolveShared, type SharedModuleConfig } from './federation/sharing.ts'
import { generateContainerFiles, type GeneratedOutput } from './generate/index.ts'
import {
  ALIASES,
  entryModulePath,
  exposeName,
  type GenerateContext,
} from './generate/modules.ts'
import { resolveOptions, type MfePluginOptions, type ResolvedOptions } from './options.ts'

export interface ContainerPlan {
  readonly options: ResolvedOptions
  readonly entryFile: string
  readonly discovery: DiscoveryResult
  readonly capabilities: readonly CapabilityDescriptor[]
  readonly configSource: ConfigSource | undefined
  readonly shared: Readonly<Record<string, SharedModuleConfig>>
  /** Module Federation exposes: generated names, not public API. */
  readonly exposes: Readonly<Record<string, string>>
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

  const entryFile = resolveEntryModule(resolved.containerRoot)
  const discovery = discoverDefinitions(entryFile)
  const configSource = readConfigSource(resolved.containerRoot)

  const capabilities = extractCapabilities({
    routesDirectory: resolved.routesDirectory,
    hasApp: discovery.app !== undefined,
    ...(discovery.app === undefined ? {} : { appId: discovery.app.id }),
  })

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

  const aliases: Record<string, string> = {
    [ALIASES.fetch]: `${resolved.generatedDir}/fetch.ts`,
    [ALIASES.meta]: `${resolved.generatedDir}/meta.ts`,
  }
  if (configSource !== undefined) aliases[ALIASES.config] = `${resolved.generatedDir}/config.ts`

  return {
    options: resolved,
    entryFile,
    discovery,
    capabilities,
    configSource,
    shared: resolveShared({
      dependencies: containerDependencies(resolved),
      overrides: resolved.sharedOverrides,
    }),
    exposes,
    aliases,
    scopes: discovery.definitions.map(definition => definition.id),
    generated,
    diagnostics: findStrayDefinitions(`${resolved.containerRoot}/src`, {
      entryFile,
      ignoredDirectories: [resolved.generatedDir],
    }),
  }
}
