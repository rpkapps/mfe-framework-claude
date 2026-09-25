/**
 * The wiring `createMfeRuntime` and the memory runtime share, so a test runs on a runtime put
 * together exactly as a shell's is: only where the registry, storage, history and loader come
 * from differs between the two.
 */

import {
  isMfeError,
  withoutUndefined,
  type DeadlineConfig,
  type MfeAdapter,
  type NavigationBridge,
  type Registry,
  type TelemetryProvider,
} from '@company/mfe-core'

import type { ActionApprovalPolicy, ActionDenialNotifier } from '../actions/action-executor.ts'
import { ActionRegistry } from '../actions/action-registry.ts'
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
  /** It must never repeat, or returning to an earlier user resurrects invalidated data. */
  readonly nextSessionGeneration: () => string
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
  })
  const breadcrumbs = new BreadcrumbStore({ diagnostics })

  // The new generation fences records written under the old one, so it is minted, not reused.
  const stopWatchingSession = shellState.observeTransitions(change => {
    if (!requiresSessionRetirement(change.transitions)) return

    const identity = change.transitions.find(transition => transition.kind === 'identity')
    storage.applySessionTransition(
      identity
        ? { kind: 'identity', reason: identity.reason, groups: change.next.groups }
        : { kind: 'groups', groups: change.next.groups },
      parts.nextSessionGeneration(),
    )
  })

  const runtime: MfeRuntime = {
    registry: parts.registry,
    loader: new SharedContainerLoader(withAdapterLoadHooks(parts.loader, parts.adapters)),
    shellState,
    storage,
    actions,
    breadcrumbs,
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
      navigator.clearBlockers()
      storage.dispose()
      shellState.dispose()
    },
  }
}
