/**
 * Everything that differs between two build integrations, stated once: the rest of a container's
 * build is the same whichever framework its definitions render with.
 */

import type { CapabilityDescriptor, DefinitionFramework } from '@company/mfe-core'

import type { CapabilityOwner } from './discovery/capabilities.ts'
import type { DefinitionSyntax, DiscoveredDefinition, DiscoveryResult } from './discovery/definitions.ts'
import type { SharingPolicies } from './federation/sharing.ts'
import type { GeneratedFile } from './generate/emit.ts'
import type { GenerateContext } from './generate/modules.ts'

export interface ContainerProfile {
  /** Named in every generated file's banner: the package a reader goes to in order to change it. */
  readonly generator: string
  readonly definitions: DefinitionSyntax
  /**
   * The modules `src/mfe.config.ts` may import `env` from. The first is also where the generated
   * `#mfe/config` imports its `InferEnvConfig` type from, so it has to be one the container
   * depends on.
   */
  readonly envModules: readonly [string, ...string[]]
  /** The adapter the generated `#mfe/fetch` imports `createContainerTransport` from. */
  readonly adapterModule: string
  /**
   * Recorded in the registry entry and the federation manifest. Left out, neither carries one,
   * which a host reads as a React container.
   */
  readonly framework?: DefinitionFramework
  /** The candidates this kind of container shares, each only when it depends on it. */
  readonly sharing: SharingPolicies
  readonly stylesheet: StylesheetProfile
  /**
   * The statements an exposed entry exports its `definition` with, in place of re-exporting the
   * author's unchanged; `null` keeps the re-export.
   */
  readonly exposeDefinition?: (
    context: GenerateContext,
    exposed: ExposedDefinition,
  ) => readonly string[] | null
  /** Files only this integration generates; they count towards the build hash like the rest. */
  readonly generatedFiles?: (context: GenerateContext) => readonly GeneratedFile[]
  /** Finds the App's capability routes; without one, a container declares none. */
  readonly readCapabilities?: (context: CapabilityContext) => readonly CapabilityDescriptor[]
  /** How an author points the integration at a container, for example `pluginMfe({ containerRoot })`. */
  readonly containerRootOption: string
}

export interface StylesheetProfile {
  /** What Tailwind scans, as a glob under `src/`: the files this container writes classes in. */
  readonly sources: string
  /** Lines added after the Tailwind imports, such as a UI library's scoped entry. */
  readonly imports?: (context: GenerateContext) => readonly string[]
}

export interface ExposedDefinition {
  /** The generated entry module the statements go into. */
  readonly file: string
  readonly definition: DiscoveredDefinition
  /** The author's entry module, as a specifier relative to `file`. */
  readonly authored: string
}

export interface CapabilityContext {
  readonly containerRoot: string
  readonly entryFile: string
  readonly discovery: DiscoveryResult
  readonly owner: CapabilityOwner
  /** The container's own sources, generated output excluded and tests included. */
  readonly sourceFiles: readonly string[]
}
