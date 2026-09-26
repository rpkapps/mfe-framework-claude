/**
 * Assembling the shell-side runtime once per document. Everything here outlives an individual
 * mount, and none of it knows which adapter will render what it loads, so every adapter's host
 * surface builds on this one implementation.
 */

import {
  withoutUndefined,
  type DeadlineConfig,
  type DiagnosticsSink,
  type MfeAdapter,
  type NavigationBridge,
  type Registry,
  type ShellState,
  type TelemetryProvider,
} from '@company/mfe-core'

import type { ActionAuditSink } from '../actions/action-audit.ts'
import type { ActionApprovalPolicy, ActionDenialNotifier } from '../actions/action-executor.ts'
import type { ActionRegistry } from '../actions/action-registry.ts'
import type { AgentContextStore } from '../agent-context/agent-context-store.ts'
import type { BreadcrumbStore } from '../breadcrumbs/breadcrumb-store.ts'
import { DiagnosticsHub } from '../diagnostics.ts'
import type { ContainerLoader } from '../loader/container-loader.ts'
import {
  createBrowserNavigationBridge,
  type BoundaryNavigator,
} from '../navigation/boundary-navigator.ts'
import { findConflictingContainerOverrides, readDevOverrides } from '../overrides/dev-overrides.ts'
import { readRegistry } from '../registry/read-registry.ts'
import { ShellStateStore } from '../shell-state/shell-state-store.ts'
import { establishSessionGeneration, mintSessionGeneration } from '../storage/session-generation.ts'
import { MfeStorageStore } from '../storage/storage-store.ts'
import { assembleRuntime, reportRejectedEntries } from './assemble-runtime.ts'

/** Shared, shell-owned services, one instance per document. */
export interface MfeRuntime {
  readonly registry: Registry
  /** Shares in-flight and resolved loads, and runs each load through its adapter's `aroundLoad`. */
  readonly loader: ContainerLoader
  readonly shellState: ShellStateStore
  readonly storage: MfeStorageStore
  readonly actions: ActionRegistry
  readonly breadcrumbs: BreadcrumbStore
  /** What the agent knows of the page with each turn: the URL, selections, prompt handoff. */
  readonly agentContext: AgentContextStore
  readonly navigator: BoundaryNavigator
  readonly telemetryProvider: TelemetryProvider
  readonly diagnostics: DiagnosticsHub
  /** The budget every mount's load, mount and disposal runs under. */
  readonly deadlines: DeadlineConfig
}

export interface CreateMfeRuntimeOptions {
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
   * Every adapter the registry is read through and loads are wrapped by; nothing is registered
   * implicitly, so the shell lists each one. Order means nothing: exactly one adapter must
   * recognise an entry, so an entry one framework's build published can never be read by another
   * adapter because one of its fields was malformed.
   */
  readonly adapters: readonly MfeAdapter[]
  /** Merged over `DEFAULT_DEADLINES`, so a shell names only the phases it tunes. */
  readonly deadlines?: Partial<DeadlineConfig>
  readonly notifyActionDenial?: ActionDenialNotifier
  /**
   * The organization's rule over the agent's calls, on top of what each action declares: it can
   * approve, ask the user, or deny one call without touching the App that registers the action.
   */
  readonly actionApprovalPolicy?: ActionApprovalPolicy
  /**
   * Takes one record for every action run: who acted (the user, the agent on the user's behalf, or
   * the host), how it was called, in which chat turn, the outcome and the input with credentials
   * redacted. The host sends it to its backend, which stores it; the runtime also reports it to
   * telemetry.
   */
  readonly auditAction?: ActionAuditSink
  /** Omitted, this call establishes one for the identity every `'user'` record is fenced by. */
  readonly sessionGeneration?: string
  /** It must never repeat, or returning to an earlier user resurrects invalidated data. */
  readonly nextSessionGeneration?: () => string
  /** Where boot-time developer URL overrides are read from. */
  readonly overrideStorage?: Pick<Storage, 'getItem'>
}

export interface MfeRuntimeHandle {
  readonly runtime: MfeRuntime
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

export function createMfeRuntime(options: CreateMfeRuntimeOptions): MfeRuntimeHandle {
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

  reportRejectedEntries(registry, diagnostics)

  const shellState = new ShellStateStore(options.shellState)
  const nextSessionGeneration = options.nextSessionGeneration ?? mintSessionGeneration
  const storage = new MfeStorageStore({
    diagnostics,
    ...withoutUndefined({ sessionGeneration: options.sessionGeneration }),
  })
  if (options.sessionGeneration === undefined) {
    // Identity is opaque and compared for equality, so an anonymous page still gets one.
    establishSessionGeneration(storage, shellState.getUser()?.id ?? ANONYMOUS_IDENTITY, {
      mint: nextSessionGeneration,
    })
  }

  const assembled = assembleRuntime({
    registry,
    loader: options.loader,
    adapters: options.adapters,
    shellState,
    storage,
    navigationBridge: options.navigationBridge ?? createBrowserNavigationBridge(),
    telemetryProvider: options.telemetryProvider,
    diagnostics,
    deadlines: options.deadlines,
    notifyActionDenial: options.notifyActionDenial,
    actionApprovalPolicy: options.actionApprovalPolicy,
    auditAction: options.auditAction,
    nextSessionGeneration,
  })

  return {
    runtime: assembled.runtime,
    activeOverrides: overrides.overrides,
    dispose: () => {
      assembled.dispose()
      if (ownsDiagnostics) diagnostics.clear()
      else for (const remove of removeSinks) remove()
    },
  }
}
