/**
 * A complete runtime with nothing behind it but memory: the stores a shell would build, a
 * recording telemetry provider, a memory navigation bridge and a loader resolving the definitions
 * a test hands it. Every call builds an independent one, so no singleton leaks between tests; an
 * adapter's own test environment adds only what renders.
 */

import {
  withoutUndefined,
  type BrandedDefinition,
  type DeadlineConfig,
  type Diagnostic,
  type MfeAdapter,
  type Registry,
  type RegistryEntry,
} from '@company/mfe-core'

import { DiagnosticsHub } from '../diagnostics.ts'
import type { LoadedDefinition } from '../loader/container-loader.ts'
import type { FederatedRegistryEntry } from '../loader/federation-loader.ts'
import { readRegistry } from '../registry/read-registry.ts'
import { assembleRuntime, reportRejectedEntries } from '../runtime/assemble-runtime.ts'
import type { MfeRuntime } from '../runtime/create-runtime.ts'
import { ShellStateStore, type ShellStatePatch } from '../shell-state/shell-state-store.ts'
import { MfeStorageStore } from '../storage/storage-store.ts'
import { createInProcessLoader } from './in-process-loader.ts'
import { createMemoryNavigationBridge } from './memory-navigation-bridge.ts'
import { createMemoryStorageArea, type MemoryStorageArea } from './memory-storage-area.ts'
import {
  createRecordingTelemetryProvider,
  type RecordingTelemetryProvider,
} from './recording-provider.ts'

export interface MemoryRuntimeOptions {
  /** Merged over a signed-in test user in the `testers` group, on the light theme. */
  readonly shellState?: ShellStatePatch
  /**
   * What the loader resolves, each listed in the registry under its own id with the adapter its
   * `framework` names, unless `registryEntries` lists that id itself.
   */
  readonly definitions?: readonly BrandedDefinition[]
  /** Raw entries as a build publishes them, read through `adapters` exactly as a shell reads them. */
  readonly registryEntries?: readonly unknown[]
  /** What `registryEntries` are read through, and whose `aroundLoad` wraps each load. */
  readonly adapters?: readonly MfeAdapter[]
  /** Merged over `DEFAULT_DEADLINES`. */
  readonly deadlines?: Partial<DeadlineConfig>
  readonly initialEntries?: readonly string[]
  readonly sessionGeneration?: string
}

export interface MemoryRuntime {
  readonly runtime: MfeRuntime
  /** Exercises real snapshot, session and group update behaviour. */
  setShellState(patch: ShellStatePatch): void
  readonly telemetry: RecordingTelemetryProvider
  /** Everything reported to the runtime's hub, in order. */
  readonly diagnostics: readonly Diagnostic[]
  readonly navigation: ReturnType<typeof createMemoryNavigationBridge>
  /** The injected browser stores, which count the calls made against them. */
  readonly storageAreas: {
    readonly local: MemoryStorageArea
    readonly session: MemoryStorageArea
  }
  /** Mounts are the caller's; dispose them first. */
  dispose(): void
}

export function createMemoryRuntime(options: MemoryRuntimeOptions = {}): MemoryRuntime {
  const diagnostics = new DiagnosticsHub()
  const recorded: Diagnostic[] = []
  diagnostics.add(diagnostic => recorded.push(diagnostic))

  // `null` is a signed-out page, so only an absent user falls back to the test user.
  const user = options.shellState?.user
  const shellState = new ShellStateStore({
    user: user === undefined ? { id: 'test-user', name: 'Test User' } : user,
    groups: options.shellState?.groups ?? ['testers'],
    theme: options.shellState?.theme ?? 'light',
  })

  const storageAreas = {
    local: createMemoryStorageArea(),
    session: createMemoryStorageArea(),
  }
  const storage = new MfeStorageStore({
    areas: storageAreas,
    diagnostics,
    eventTarget: null,
    sessionGeneration: options.sessionGeneration ?? 'test-session',
  })

  const telemetry = createRecordingTelemetryProvider()
  const navigation = createMemoryNavigationBridge(options.initialEntries ?? ['/'])

  const definitions = options.definitions ?? []
  const loadable = new Map<string, LoadedDefinition>(
    definitions.map(definition => [
      definition.id,
      {
        identity: {
          id: definition.id,
          kind: definition.kind,
          ...withoutUndefined({ version: definition.version }),
        },
        module: definition,
      },
    ]),
  )

  // Parsed by whichever adapter built the definition, as a published entry would be.
  const entries = new Map<string, RegistryEntry>(
    definitions.map((definition): [string, FederatedRegistryEntry] => [
      definition.id,
      {
        id: definition.id,
        definitionKind: definition.kind,
        adapter: definition.framework,
        manifestUrl: `memory://${definition.id}`,
        container: definition.id.replaceAll('-', '_'),
      },
    ]),
  )

  // What a published entry says wins over what a definition implies, as it would on a page.
  const adapters = options.adapters ?? []
  const read = readRegistry(options.registryEntries ?? [], { adapters })
  for (const [id, entry] of read.entries) entries.set(id, entry)
  const registry: Registry = { entries, rejected: read.rejected }
  reportRejectedEntries(registry, diagnostics)

  // Minted per transition, so a test exercises the real fencing rather than a fixed value.
  let generation = 0
  const assembled = assembleRuntime({
    registry,
    loader: createInProcessLoader(loadable),
    adapters,
    shellState,
    storage,
    navigationBridge: navigation,
    telemetryProvider: telemetry,
    diagnostics,
    deadlines: options.deadlines,
    nextSessionGeneration: () => {
      generation += 1
      return `test-session-${String(generation)}`
    },
  })

  return {
    runtime: assembled.runtime,
    setShellState: patch => {
      shellState.apply(patch)
    },
    telemetry,
    diagnostics: recorded,
    navigation,
    storageAreas,
    dispose: () => {
      assembled.dispose()
      diagnostics.clear()
    },
  }
}
