/**
 * Assembling the shell-side runtime once per document. Everything here outlives an individual
 * mount, and none of it knows which adapter will render what it loads, so every adapter's host
 * surface builds on this one implementation.
 */

import {
  DiagnosticsHub,
  isMfeError,
  type DiagnosticsSink,
  type MfeAdapter,
  type NavigationBridge,
  type Registry,
  type ShellState,
  type TelemetryProvider,
} from '@company/mfe-core'

import { BreadcrumbStore } from '../breadcrumbs/breadcrumb-store.ts'
import { CommandRegistry, type CommandDenialNotifier } from '../commands/command-registry.ts'
import { SharedContainerLoader, type ContainerLoader } from '../loader/container-loader.ts'
import {
  BoundaryNavigator,
  createBrowserNavigationBridge,
} from '../navigation/boundary-navigator.ts'
import { findConflictingContainerOverrides, readDevOverrides } from '../overrides/dev-overrides.ts'
import { readRegistry } from '../registry/read-registry.ts'
import {
  requiresSessionRetirement,
  ShellStateStore,
} from '../shell-state/shell-state-store.ts'
import {
  establishSessionGeneration,
  mintSessionGeneration,
} from '../storage/session-generation.ts'
import { MfeStorageStore } from '../storage/storage-store.ts'

/** Shared, shell-owned services, one instance per document. */
export interface MfeHostRuntime {
  readonly registry: Registry
  readonly loader: ContainerLoader
  readonly shellState: ShellStateStore
  readonly storage: MfeStorageStore
  readonly commands: CommandRegistry
  readonly breadcrumbs: BreadcrumbStore
  readonly navigator: BoundaryNavigator
  readonly telemetryProvider: TelemetryProvider
  readonly diagnostics: DiagnosticsHub
}

export interface CreateHostRuntimeOptions {
  /** Raw registry entries, usually fetched by the shell at boot. */
  readonly registryEntries: readonly unknown[]
  /** In production this is the federation loader. */
  readonly loader: ContainerLoader
  readonly shellState: ShellState
  readonly telemetryProvider: TelemetryProvider
  readonly navigationBridge?: NavigationBridge
  readonly diagnosticsSinks?: readonly DiagnosticsSink[]
  /** An existing hub to report into; `dispose()` removes only the sinks it added (§25). */
  readonly diagnostics?: DiagnosticsHub
  /**
   * Every adapter the registry is read through; nothing is registered implicitly, so an
   * adapter's own `createMfeRuntime` is where its adapter joins the list. Order means nothing:
   * exactly one adapter must recognise an entry, so an entry one framework's build published can
   * never be read by another adapter because one of its fields was malformed.
   */
  readonly adapters: readonly MfeAdapter[]
  readonly notifyCommandDenial?: CommandDenialNotifier
  /** Omitted, this call establishes one for the identity every `'user'` record is fenced by. */
  readonly sessionGeneration?: string
  /** It must never repeat, or returning to an earlier user resurrects invalidated data. */
  readonly nextSessionGeneration?: () => string
  /** Where boot-time developer URL overrides are read from. */
  readonly overrideStorage?: Pick<Storage, 'getItem'>
}

export interface HostRuntimeHandle {
  readonly runtime: MfeHostRuntime
  /** Applied developer overrides, for the shell's active-override indicator. */
  readonly activeOverrides: ReadonlyMap<string, string>
  dispose(): void
}

/** A page with nobody signed in still fences its own session-retained writes. */
const ANONYMOUS_IDENTITY = '@anonymous'

/** This map only exists to find a conflict, never to load anything. */
function containersByDefinitionId(entries: readonly unknown[]): ReadonlyMap<string, string> {
  const byId = new Map<string, string>()

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as { id?: unknown; container?: unknown }
    if (typeof record.id !== 'string' || typeof record.container !== 'string') continue
    byId.set(record.id, record.container)
  }

  return byId
}

export function createHostRuntime(options: CreateHostRuntimeOptions): HostRuntimeHandle {
  const ownsDiagnostics = options.diagnostics === undefined
  const diagnostics = options.diagnostics ?? new DiagnosticsHub()
  const removeSinks = (options.diagnosticsSinks ?? []).map(sink => diagnostics.add(sink))

  // Read before anything is registered, so an override applies the first time an entry loads.
  const overrides = readDevOverrides(options.overrideStorage)
  for (const error of overrides.diagnostics) diagnostics.report(error, { severity: 'warning' })

  const registry: Registry = readRegistry(options.registryEntries, {
    adapters: options.adapters,
    overrides: overrides.overrides,
  })

  // One container is registered once under one name, so two of its definitions pointed at
  // different URLs cannot both apply.
  for (const error of findConflictingContainerOverrides(
    overrides.overrides,
    containersByDefinitionId(options.registryEntries),
  )) {
    diagnostics.report(error, { severity: 'warning' })
  }

  // A rejected entry never removes unrelated valid ones.
  for (const rejected of registry.rejected) {
    if (isMfeError(rejected.error)) {
      diagnostics.report(rejected.error, {
        severity: 'error',
        context: { entry: rejected.id, reason: rejected.reason },
      })
    }
  }

  const shellState = new ShellStateStore(options.shellState)
  const nextGeneration = options.nextSessionGeneration ?? mintSessionGeneration
  const storage = new MfeStorageStore({
    diagnostics,
    ...(options.sessionGeneration === undefined
      ? {}
      : { sessionGeneration: options.sessionGeneration }),
  })
  if (options.sessionGeneration === undefined) {
    // Identity is opaque and compared for equality, so an anonymous page still gets one.
    establishSessionGeneration(storage, shellState.getUser()?.id ?? ANONYMOUS_IDENTITY, {
      mint: nextGeneration,
    })
  }

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

  // The new generation fences records written under the old one, so it is minted, not reused.
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

  const runtime: MfeHostRuntime = {
    registry,
    loader: new SharedContainerLoader(options.loader),
    shellState,
    storage,
    commands,
    breadcrumbs,
    navigator,
    telemetryProvider: options.telemetryProvider,
    diagnostics,
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
      if (ownsDiagnostics) diagnostics.clear()
      else for (const remove of removeSinks) remove()
    },
  }
}
