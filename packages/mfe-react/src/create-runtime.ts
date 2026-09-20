/**
 * Assembling the shell-side runtime, and deriving a mount from it.
 *
 * The shell calls `createMfeRuntime` once. Ownership stays legible because
 * anything on the runtime outlives an individual mount, and anything
 * `createMount` returns is torn down with it.
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
   * resurrect the data that was invalidated with it. A shell that coordinates
   * several tabs supplies its own; the default is a random identifier.
   */
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

/**
 * Definition id → container name, read from the descriptors as published. The
 * normalized entry hides the container in `adapterData`; the raw registry entry
 * still states it, and a descriptor that names neither is simply left out —
 * this map only exists to find a conflict, never to load anything.
 */
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
  const diagnostics = new DiagnosticsHub()
  for (const sink of options.diagnosticsSinks ?? []) diagnostics.add(sink)

  // Read before anything is registered, so an overridden entry already points at
  // the developer's dev server the first time it loads.
  const overrides = readDevOverrides(options.overrideStorage)
  for (const error of overrides.diagnostics) diagnostics.report(error, { severity: 'warning' })

  const registry: NormalizedRegistry = normalizeRegistry(options.registryEntries, {
    rules: [createMfeContractRule()],
    overrides: overrides.overrides,
  })

  // One container is registered once, under one name, so two of its definitions
  // pointed at different URLs cannot both apply — whichever registered first
  // wins and the other override silently does nothing. Reported from here
  // rather than from the normalized entries, because the container name is
  // adapter-private by then and the raw descriptors still carry it.
  for (const error of findConflictingContainerOverrides(
    overrides.overrides,
    containersByDefinitionId(options.registryEntries),
  )) {
    diagnostics.report(error, { severity: 'warning' })
  }

  // A quarantined entry never removes unrelated valid ones; it is reported and
  // the rest of the shell keeps working.
  for (const quarantined of registry.quarantined) {
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
 * Nested and repeated mounts get independent Query clients, so a child never
 * inherits a parent's cache. That boundary is framework policy rather than
 * something TanStack Query requires.
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
      // Cancellation is signalled, not waited on: `clear()` drops the cache
      // immediately and teardown must not block on in-flight requests.
      void queryClient.cancelQueries()
      queryClient.clear()
      telemetry.dispose()
      overlay.dispose()

      await Promise.resolve()
    },
  }
}

/**
 * The mount this component owns, created and destroyed as an effect.
 *
 * React may unmount a component and immediately mount it again without
 * re-rendering it. StrictMode does exactly that on every mount in development,
 * and it is deliberate: the same thing happens whenever React reuses state it
 * had previously torn down.
 *
 * A mount built in `useMemo` and destroyed in an effect cleanup does not
 * survive it. The cleanup disposes the mount; the second setup runs against the
 * same memoized handle, because its inputs have not changed; and from then on
 * the App is running on a disposed mount — an aborted signal, a Query cache
 * that was cleared and now cancels everything put into it, a removed overlay
 * root, a disposed tracer. The symptom is a route loader failing with
 * `CancelledError` in development and working in production, which is the worst
 * shape a defect can have.
 *
 * Creating it in the effect instead is the pairing React actually supports: the
 * thing that tears a resource down and the thing that builds it are the same
 * effect, so a remount builds a new one. It costs one render returning nothing
 * before the mount exists, which is a frame inside a Suspense boundary that was
 * already showing a fallback.
 *
 * A generation counter bumped from the cleanup looks like a smaller fix and is
 * not one: the cleanup it schedules is itself a cleanup, so it bumps again, and
 * the component renders forever.
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

/** The counter fallback keeps non-secure contexts working; uniqueness per document is enough. */
let generationCounter = 0
function defaultSessionGeneration(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  generationCounter += 1
  return `session-${Date.now()}-${generationCounter}`
}
