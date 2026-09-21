/**
 * Assembling the shell-side runtime and deriving a mount from it: anything on the runtime
 * outlives an individual mount, and anything `createMount` returns is torn down with it.
 */

import {
  DiagnosticsHub,
  isMfeError,
  type AdapterSelectionRule,
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
  establishSessionGeneration,
  mintSessionGeneration,
  normalizeRegistry,
  MfeStorageStore,
  findConflictingContainerOverrides,
  readDevOverrides,
  requiresSessionRetirement,
  SharedContainerLoader,
  ShellStateStore,
  type CommandDenialNotifier,
  type ContainerLoader,
} from '@company/mfe-host'
import { QueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { createOverlayRoot } from './scope-root.tsx'
import { createMountToken, type MfeMount, type MfeRuntime } from './runtime.ts'

export interface CreateRuntimeOptions {
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
   * Extra adapter selection rules, evaluated after the framework contract rule, which always
   * runs first. The first rule that advertises an entry owns it, so a descriptor advertising
   * the framework contract can never fall through to another adapter because a field in it was
   * malformed: that entry is quarantined instead of loading a different way.
   */
  readonly rules?: readonly AdapterSelectionRule[]
  readonly notifyCommandDenial?: CommandDenialNotifier
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

export function createMfeRuntime(options: CreateRuntimeOptions): MfeRuntimeHandle {
  const ownsDiagnostics = options.diagnostics === undefined
  const diagnostics = options.diagnostics ?? new DiagnosticsHub()
  const removeSinks = (options.diagnosticsSinks ?? []).map(sink => diagnostics.add(sink))

  // Read before anything is registered, so an override applies the first time an entry loads.
  const overrides = readDevOverrides(options.overrideStorage)
  for (const error of overrides.diagnostics) diagnostics.report(error, { severity: 'warning' })

  const registry: NormalizedRegistry = normalizeRegistry(options.registryEntries, {
    rules: [createMfeContractRule(), ...(options.rules ?? [])],
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

  // A quarantined entry never removes unrelated valid ones.
  for (const quarantined of registry.quarantined) {
    if (isMfeError(quarantined.error)) {
      diagnostics.report(quarantined.error, {
        severity: 'error',
        context: { entry: quarantined.id, reason: quarantined.reason },
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

export interface CreateMountOptions {
  readonly runtime: MfeRuntime
  readonly definitionId: string
  readonly definitionVersion?: string
  readonly kind: 'app' | 'widget'
  /** The assigned URL boundary, always `''` for a Widget. */
  readonly basePath?: string
  readonly depth?: number
  readonly document?: Document
}

export interface MountHandleWithCleanup {
  readonly mount: MfeMount
  /** Tears down everything this mount owns; the ordering is deliberate. */
  dispose(): Promise<void>
}

/** Every mount gets its own Query client, so a child never inherits a parent's cache. */
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
      // Registrations go first, so a disposed mount cannot appear in the palette mid-teardown.
      runtime.commands.removeMount(mountToken)
      runtime.navigator.removeMount(mountToken)

      disposal.abort()
      // Signalled, not waited on: teardown must not block on in-flight requests.
      void queryClient.cancelQueries()
      queryClient.clear()
      telemetry.dispose()
      overlay.dispose()

      await Promise.resolve()
    },
  }
}

/**
 * The mount this component owns, created and destroyed by the same effect, because a mount
 * built in `useMemo` does not survive the remount StrictMode performs (§14).
 */
export function useOwnedMount(
  create: () => MountHandleWithCleanup,
  deps: readonly unknown[],
): MfeMount | null {
  const [handle, setHandle] = useState<MountHandleWithCleanup | null>(null)

  useEffect(
    () => {
      const created = create()

      // The rule is right about the general case and this is the exception it
      // names: an effect that connects to an external system has to publish the
      // thing it connected to. Creating the mount during render instead is what
      // React actually forbids — it appends an overlay root to the document,
      // starts a tracer and allocates a Query client, none of which belong in a
      // render React may discard.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setHandle(created)

      return () => {
        void created.dispose()
      }
    },
    // `create` is called by the effect and is rebuilt on every render by every
    // call site, so it is deliberately not a dependency; `deps` names what the
    // mount is actually derived from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  )

  return handle?.mount ?? null
}
