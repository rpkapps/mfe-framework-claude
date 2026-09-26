/**
 * The wiring `createMfeRuntime` and the memory runtime share, so a test runs on a runtime put
 * together exactly as a shell's is: only where the registry, storage, history and loader come
 * from differs between the two.
 */

import {
  isMfeError,
  toMfeError,
  withoutUndefined,
  type DeadlineConfig,
  type MfeAdapter,
  type NavigationBridge,
  type Registry,
  type ShellState,
  type TelemetryProvider,
} from '@company/mfe-core'

import { auditTelemetryRecord, type ActionAuditSink } from '../actions/action-audit.ts'
import type { ActionApprovalPolicy, ActionDenialNotifier } from '../actions/action-executor.ts'
import { ActionRegistry } from '../actions/action-registry.ts'
import { AgentContextStore } from '../agent-context/agent-context-store.ts'
import { BreadcrumbStore } from '../breadcrumbs/breadcrumb-store.ts'
import { DEFAULT_DEADLINES } from '../deadline.ts'
import type { DiagnosticsHub } from '../diagnostics.ts'
import { withAdapterLoadHooks } from '../loader/adapter-load-hooks.ts'
import { SharedContainerLoader, type ContainerLoader } from '../loader/container-loader.ts'
import { BoundaryNavigator } from '../navigation/boundary-navigator.ts'
import {
  requiresSessionRetirement,
  type ShellStateStore,
} from '../shell-state/shell-state-store.ts'
import type { MfeStorageStore } from '../storage/storage-store.ts'
import type { MfeRuntime } from './create-runtime.ts'

/** A rejected entry never removes unrelated valid ones, so each is reported and the rest load. */
export function reportRejectedEntries(registry: Registry, diagnostics: DiagnosticsHub): void {
  for (const rejected of registry.rejected) {
    if (isMfeError(rejected.error)) {
      diagnostics.report(rejected.error, {
        severity: 'error',
        context: { entry: rejected.id, reason: rejected.reason },
      })
    }
  }
}

export interface RuntimeParts {
  readonly registry: Registry
  /** Wrapped in each entry's adapter's `aroundLoad`, then shared. */
  readonly loader: ContainerLoader
  readonly adapters: readonly MfeAdapter[]
  readonly shellState: ShellStateStore
  readonly storage: MfeStorageStore
  readonly navigationBridge: NavigationBridge
  readonly telemetryProvider: TelemetryProvider
  readonly diagnostics: DiagnosticsHub
  /** Merged over `DEFAULT_DEADLINES`. */
  readonly deadlines?: Partial<DeadlineConfig> | undefined
  readonly notifyActionDenial?: ActionDenialNotifier | undefined
  readonly actionApprovalPolicy?: ActionApprovalPolicy | undefined
  readonly auditAction?: ActionAuditSink | undefined
  /** It must never repeat, or returning to an earlier user resurrects invalidated data. */
  readonly nextSessionGeneration: () => string
  /** Told of each generation a transition minted, for a runtime that persists the one in force. */
  readonly onSessionRotated?: ((next: ShellState, generation: string) => void) | undefined
}

export interface AssembledRuntime {
  readonly runtime: MfeRuntime
  /** Everything but the diagnostics hub, which each caller owns differently. */
  dispose(): void
}

export function assembleRuntime(parts: RuntimeParts): AssembledRuntime {
  const { diagnostics, shellState, storage } = parts

  const navigator = new BoundaryNavigator({ bridge: parts.navigationBridge, diagnostics })
  const actions = new ActionRegistry({
    diagnostics,
    // An App's shortcuts fire while the page is inside its boundary, read where it is read for
    // navigation.
    readPathname: () => navigator.read().pathname,
    ...withoutUndefined({
      notifyDenial: parts.notifyActionDenial,
      approvalPolicy: parts.actionApprovalPolicy,
    }),
    // Every run goes to telemetry, as a framework record, and to the host, whose backend stores it.
    // The host's copy is the record of who acted, so a telemetry provider that throws is caught
    // and reported on its own rather than skipping it; a host sink that throws is the executor's
    // to report.
    audit: record => {
      try {
        const reported = auditTelemetryRecord(record)
        if (parts.telemetryProvider.isLevelEnabled?.(reported.level) !== false) {
          parts.telemetryProvider.record(reported)
        }
      } catch (failure) {
        diagnostics.report(
          toMfeError(failure, {
            code: 'config/invalid',
            id: record.definitionId,
            operation: `record the audit of '${record.actionId}' in telemetry`,
            expected: 'a telemetry provider that returns without throwing',
            repair: 'Fix the provider so it buffers or drops internally.',
          }),
          { severity: 'warning' },
        )
      }
      parts.auditAction?.(record)
    },
    readUserId: () => shellState.getSnapshot().user?.id,
  })
  const breadcrumbs = new BreadcrumbStore({ diagnostics })
  const agentContext = new AgentContextStore({
    diagnostics,
    readLocation: () => navigator.read(),
  })

  // The new generation fences records written under the old one, so it is minted, not reused.
  const stopWatchingSession = shellState.observeTransitions(change => {
    if (!requiresSessionRetirement(change.transitions)) return

    const identity = change.transitions.find(transition => transition.kind === 'identity')
    const result = storage.applySessionTransition(
      identity
        ? { kind: 'identity', reason: identity.reason, groups: change.next.groups }
        : { kind: 'groups', groups: change.next.groups },
      parts.nextSessionGeneration(),
    )
    if (result.outcome === 'invalidated' && result.generation !== null) {
      parts.onSessionRotated?.(change.next, result.generation)
    }
  })

  const runtime: MfeRuntime = {
    registry: parts.registry,
    loader: new SharedContainerLoader(withAdapterLoadHooks(parts.loader, parts.adapters)),
    shellState,
    storage,
    actions,
    breadcrumbs,
    agentContext,
    navigator,
    telemetryProvider: parts.telemetryProvider,
    diagnostics,
    deadlines: Object.freeze({ ...DEFAULT_DEADLINES, ...parts.deadlines }),
  }

  return {
    runtime,
    dispose: () => {
      stopWatchingSession()
      actions.dispose()
      breadcrumbs.dispose()
      agentContext.dispose()
      navigator.clearBlockers()
      storage.dispose()
      shellState.dispose()
    },
  }
}
