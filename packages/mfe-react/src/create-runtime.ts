/**
 * Assembling the shell-side runtime, and deriving a mount from it.
 *
 * The shell calls `createMfeRuntime` once. Every mount is then created from it,
 * which is what keeps ownership legible: anything on the runtime outlives an
 * individual mount, and anything `createMount` returns is torn down with it.
 */

import {
  DEFAULT_DEADLINES,
  DiagnosticsHub,
  isMfeError,
  type DeadlineConfig,
  type DiagnosticsSink,
  type NavigationBridge,
  type NormalizedRegistry,
  type ShellState,
  type TelemetryProvider,
} from '@company/mfe-core'
import {
  BoundaryNavigator,
  BreadcrumbStore,
  CommandRegistry,
  createBrowserNavigationBridge,
  createMfeContractRule,
  createMountTelemetry,
  normalizeRegistry,
  MfeStorageStore,
  readDevOverrides,
  requiresSessionRetirement,
  SharedContainerLoader,
  ShellStateStore,
  type CommandDenialNotifier,
  type ContainerLoader,
} from '@company/mfe-host'
import { QueryClient } from '@tanstack/react-query'

import { createOverlayRoot } from './scope-root.tsx'
import { createMountToken, type MfeMount, type MfeRuntime } from './runtime.ts'

export interface CreateRuntimeOptions {
  /** Raw registry entries, usually fetched by the shell at boot. */
  readonly registryEntries: readonly unknown[]
  /** The concrete container loader. In production this is the federation loader. */
  readonly loader: ContainerLoader
  readonly shellState: ShellState
  readonly telemetryProvider: TelemetryProvider
  readonly navigationBridge?: NavigationBridge
  readonly diagnosticsSinks?: readonly DiagnosticsSink[]
  readonly deadlines?: Partial<DeadlineConfig>
  readonly notifyCommandDenial?: CommandDenialNotifier
  /** Opaque, stable for a continuous session across reloads. */
  readonly sessionGeneration?: string
  /**
   * Mints the generation for a new session. It must never repeat a previous
   * value: returning to an earlier user or group configuration must not
   * resurrect the data that was invalidated with it. The default is a random
   * identifier, which satisfies that; a shell that coordinates several tabs
   * supplies its own instead.
   */
  readonly nextSessionGeneration?: () => string
  /** Where boot-time developer URL overrides are read from. */
  readonly overrideStorage?: Pick<Storage, 'getItem'>
}

export interface MfeRuntimeHandle {
  readonly runtime: MfeRuntime
  /** Developer overrides that were applied, for the shell's active-override indicator. */
  readonly activeOverrides: ReadonlyMap<string, string>
  dispose(): void
}

export function createMfeRuntime(options: CreateRuntimeOptions): MfeRuntimeHandle {
  const diagnostics = new DiagnosticsHub()
  for (const sink of options.diagnosticsSinks ?? []) diagnostics.add(sink)

  // Overrides are read before anything is registered, so an overridden entry is
  // already pointing at the developer's dev server the first time it loads.
  const overrides = readDevOverrides(options.overrideStorage)
  for (const error of overrides.diagnostics) diagnostics.report(error, { severity: 'warning' })

  const registry: NormalizedRegistry = normalizeRegistry(options.registryEntries, {
    rules: [createMfeContractRule()],
    overrides: overrides.overrides,
  })

  for (const quarantined of registry.quarantined) {
    // A quarantined entry never removes unrelated valid ones; it is reported and
    // the rest of the shell keeps working.
    if (isMfeError(quarantined.error)) {
      diagnostics.report(quarantined.error, {
        severity: 'error',
        context: { entry: quarantined.id, reason: quarantined.reason },
      })
    }
  }

  const shellState = new ShellStateStore(options.shellState)
  const storage = new MfeStorageStore({
    diagnostics,
    ...(options.sessionGeneration === undefined
      ? {}
      : { sessionGeneration: options.sessionGeneration }),
  })

  const commands = new CommandRegistry({
    diagnostics,
    ...(options.notifyCommandDenial === undefined
      ? {}
      : { notifyDenial: options.notifyCommandDenial }),
  })
  const breadcrumbs = new BreadcrumbStore({ diagnostics })
  const navigator = new BoundaryNavigator({
    bridge: options.navigationBridge ?? createBrowserNavigationBridge(),
    diagnostics,
  })

  const nextGeneration = options.nextSessionGeneration ?? defaultSessionGeneration

  // An identity or semantic group change retires persisted session state before
  // any new-session value can be read back. The new generation is what fences
  // records written under the old one, so it is minted here rather than reused.
  const stopWatchingSession = shellState.observeTransitions(change => {
    if (!requiresSessionRetirement(change.transitions)) return

    const identity = change.transitions.find(transition => transition.kind === 'identity')
    storage.applySessionTransition(
      identity
        ? { kind: 'identity', reason: identity.reason, groups: change.next.groups }
        : { kind: 'groups', groups: change.next.groups },
      nextGeneration(),
    )
  })

  const runtime: MfeRuntime = {
    registry,
    loader: new SharedContainerLoader(options.loader),
    shellState,
    storage,
    commands,
    breadcrumbs,
    navigator,
    telemetryProvider: options.telemetryProvider,
    diagnostics,
    deadlines: { ...DEFAULT_DEADLINES, ...options.deadlines },
  }

  return {
    runtime,
    activeOverrides: overrides.overrides,
    dispose: () => {
      stopWatchingSession()
      commands.dispose()
      breadcrumbs.dispose()
      navigator.clearBlockers()
      storage.dispose()
      shellState.dispose()
      diagnostics.clear()
    },
  }
}

export interface CreateMountOptions {
  readonly runtime: MfeRuntime
  readonly definitionId: string
  readonly definitionVersion?: string
  readonly kind: 'app' | 'widget'
  /** The assigned URL boundary. Always `''` for a Widget. */
  readonly basePath?: string
  readonly depth?: number
  readonly document?: Document
}

export interface MountHandleWithCleanup {
  readonly mount: MfeMount
  /** Tears down everything this mount owns. Ordering is deliberate. */
  dispose(): Promise<void>
}

/**
 * Creates the per-mount services: a Query client, namespaced storage handles,
 * bound telemetry, an overlay root and the disposal signal.
 *
 * Nested and repeated mounts get independent Query clients by default, so a
 * child never inherits a parent's cache. That boundary is a framework policy
 * rather than something TanStack Query requires.
 */
export function createMount(options: CreateMountOptions): MountHandleWithCleanup {
  const { runtime, definitionId, kind } = options
  const mountToken = createMountToken(definitionId)
  const disposal = new AbortController()

  const queryClient = new QueryClient()

  const telemetry = createMountTelemetry(runtime.telemetryProvider, {
    definitionId,
    definitionKind: kind,
    ...(options.definitionVersion === undefined
      ? {}
      : { definitionVersion: options.definitionVersion }),
    mountToken,
  })

  const overlay = createOverlayRoot(definitionId, mountToken, options.document ?? document)

  const mount: MfeMount = {
    runtime,
    definitionId,
    definitionVersion: options.definitionVersion,
    kind,
    mountToken,
    depth: options.depth ?? 1,
    basePath: kind === 'widget' ? '' : (options.basePath ?? ''),
    telemetry,
    storage: {
      local: runtime.storage.storageFor(definitionId, 'local'),
      session: runtime.storage.storageFor(definitionId, 'session'),
    },
    signal: disposal.signal,
    queryClient,
    overlayRoot: overlay.element,
  }

  return {
    mount,
    dispose: async () => {
      // Registrations go first so a disposed mount cannot appear in the palette
      // or the breadcrumb trail while the rest of teardown runs.
      runtime.commands.removeMount(mountToken)
      runtime.navigator.removeMount(mountToken)

      disposal.abort()
      queryClient.cancelQueries()
      queryClient.clear()
      telemetry.dispose()
      overlay.dispose()

      await Promise.resolve()
    },
  }
}

/**
 * A fresh opaque generation. `randomUUID` is used where available; the counter
 * fallback keeps non-secure contexts and older test environments working, and
 * uniqueness within a document is all a generation needs.
 */
let generationCounter = 0
function defaultSessionGeneration(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  generationCounter += 1
  return `session-${Date.now()}-${generationCounter}`
}
