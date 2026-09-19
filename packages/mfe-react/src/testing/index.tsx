/**
 * `@company/mfe-react/testing` — supported author testing utilities.
 *
 * Never imported by the production entry. It supplies isolated providers,
 * explicit fixtures and deterministic cleanup — never live credentials, and no
 * claim to cover federation, CSS layout or authenticated integration.
 */

import {
  DEFAULT_DEADLINES,
  DiagnosticsHub,
  type Diagnostic,
  type ShellTheme,
  type ShellUser,
} from '@company/mfe-core'
import {
  BoundaryNavigator,
  BreadcrumbStore,
  CommandRegistry,
  MfeStorageStore,
  requiresSessionRetirement,
  SharedContainerLoader,
  ShellStateStore,
  type LoadedDefinition,
} from '@company/mfe-host'
import {
  createInProcessLoader,
  createMemoryNavigationBridge,
  createMemoryStorageArea,
  createRecordingTelemetryProvider,
  type MemoryStorageArea,
  type RecordingTelemetryProvider,
} from '@company/mfe-host/testing'
import { act, render, type RenderResult } from '@testing-library/react'

import { resetMfeConfig as resetMfeConfigState } from './generated/config.ts'
import { resetMfeFetch as resetMfeFetchState } from './generated/fetch.ts'
import type { ReactNode } from 'react'

import { AppMount, createRouterContext } from '../app-mount.tsx'
import { createMount } from '../create-runtime.ts'
import { MfeProvider } from '../runtime-context.tsx'
import { MfeMountProvider } from '../mount-context.tsx'
import { WidgetMount, declaredEventNames, partitionWidgetProps } from '../widget-mount.tsx'
import type { AppDefinition, MfeDefinition, WidgetDefinition } from '../definition.ts'
import type { MfeRouterContext } from '../router-contract.ts'
import type { MfeMount, MfeRuntime } from '../runtime.ts'

/**
 * The generated-alias fixtures. A container's vitest config points `#mfe/config`
 * and `#mfe/fetch` at `@company/mfe-react/testing/mfe-config` and
 * `.../mfe-fetch`, and a test installs values through these. The source under
 * test keeps its production imports (§14); nothing here is a second
 * configuration API.
 */
export { setMfeConfig, resetMfeConfig } from './generated/config.ts'
export {
  mfeRequests,
  setMfeAccessToken,
  setMfeApiBaseUrl,
  setMfeApiOrigins,
  setMfeFetch,
  resetMfeFetch,
  type MfeFetchHandler,
  type MfeFetchRecord,
} from './generated/fetch.ts'

/** Everything the aliases hold, cleared. The shared vitest setup calls it. */
export function resetGeneratedAliases(): void {
  resetMfeConfigState()
  resetMfeFetchState()
}

export interface TestShellState {
  readonly user?: ShellUser | null
  readonly groups?: readonly string[]
  readonly theme?: ShellTheme
}

export interface MfeTestEnvironmentOptions {
  /** The definition id the simulated mount runs as. */
  readonly definitionId?: string
  readonly definitionVersion?: string
  readonly kind?: 'app' | 'widget'
  readonly basePath?: string
  readonly shellState?: TestShellState
  /** Definitions the in-process loader can resolve, by id. */
  readonly definitions?: readonly MfeDefinition[]
  readonly initialEntries?: readonly string[]
  readonly sessionGeneration?: string
}

export interface MfeTestEnvironment {
  readonly runtime: MfeRuntime
  readonly mount: MfeMount
  /** Wraps components and hooks in the real framework providers. */
  readonly wrapper: (props: { readonly children: ReactNode }) => ReactNode
  /** Typed context for native route tests, with the same mount-owned client. */
  readonly routerContext: MfeRouterContext
  /** Exercises real snapshot, session and group update behaviour. */
  setShellState(patch: TestShellState): void
  readonly telemetry: RecordingTelemetryProvider
  readonly diagnostics: readonly Diagnostic[]
  readonly navigation: ReturnType<typeof createMemoryNavigationBridge>
  /** The injected browser stores, which count the calls made against them. */
  readonly storageAreas: {
    readonly local: MemoryStorageArea
    readonly session: MemoryStorageArea
  }
  dispose(): Promise<void>
}

/**
 * Builds a single simulated mount with explicit fixtures. Every environment is
 * independent — separate stores, storage areas and recorded telemetry — so no
 * singleton leaks state between tests.
 */
export function createMfeTestEnvironment(
  options: MfeTestEnvironmentOptions = {},
): MfeTestEnvironment {
  const definitionId = options.definitionId ?? 'test-definition'
  const kind = options.kind ?? 'app'

  const diagnostics = new DiagnosticsHub()
  const recorded: Diagnostic[] = []
  diagnostics.add(diagnostic => recorded.push(diagnostic))

  const shellState = new ShellStateStore({
    user: options.shellState?.user ?? { id: 'test-user', name: 'Test User' },
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

  const telemetryProvider = createRecordingTelemetryProvider()
  const navigation = createMemoryNavigationBridge(options.initialEntries ?? ['/'])

  const loadable = new Map<string, LoadedDefinition>(
    (options.definitions ?? []).map(definition => [
      definition.id,
      {
        identity: {
          id: definition.id,
          kind: definition.kind,
          ...(definition.version === undefined ? {} : { version: definition.version }),
        },
        module: definition,
      },
    ]),
  )

  const runtime: MfeRuntime = {
    registry: {
      entries: new Map(
        [...loadable].map(([id, loaded]) => [
          id,
          {
            id,
            definitionKind: loaded.identity.kind,
            adapter: 'react' as const,
            manifestUrl: `memory://${id}`,
          },
        ]),
      ),
      quarantined: [],
    },
    loader: new SharedContainerLoader(createInProcessLoader(loadable)),
    shellState,
    storage,
    commands: new CommandRegistry({ diagnostics }),
    breadcrumbs: new BreadcrumbStore({ diagnostics }),
    navigator: new BoundaryNavigator({ bridge: navigation, diagnostics }),
    telemetryProvider,
    diagnostics,
    deadlines: DEFAULT_DEADLINES,
  }

  // Generations are minted per transition so a test exercises the real fencing:
  // records written under a retired generation must not come back when the same
  // user or group set returns.
  let generation = 0
  const stopWatchingSession = shellState.observeTransitions(change => {
    if (!requiresSessionRetirement(change.transitions)) return

    generation += 1
    const identity = change.transitions.find(transition => transition.kind === 'identity')
    storage.applySessionTransition(
      identity
        ? { kind: 'identity', reason: identity.reason, groups: change.next.groups }
        : { kind: 'groups', groups: change.next.groups },
      `test-session-${generation}`,
    )
  })

  const handle = createMount({
    runtime,
    definitionId,
    ...(options.definitionVersion === undefined
      ? {}
      : { definitionVersion: options.definitionVersion }),
    kind,
    ...(options.basePath === undefined ? {} : { basePath: options.basePath }),
  })

  return {
    runtime,
    mount: handle.mount,
    wrapper: ({ children }) => (
      <MfeProvider runtime={runtime}>
        <MfeMountProvider mount={handle.mount}>{children}</MfeMountProvider>
      </MfeProvider>
    ),
    routerContext: createRouterContext(handle.mount),
    // Wrapped in `act` so updates land inside the test's normal React boundary.
    setShellState: patch => {
      act(() => {
        shellState.apply(patch)
      })
    },
    telemetry: telemetryProvider,
    diagnostics: recorded,
    navigation,
    storageAreas,
    dispose: async () => {
      stopWatchingSession()
      await handle.dispose()
      runtime.commands.dispose()
      runtime.breadcrumbs.dispose()
      storage.dispose()
      shellState.dispose()
      diagnostics.clear()
    },
  }
}

/**
 * Renders a tree that will suspend, inside an awaited act scope.
 *
 * Anything that loads a definition suspends on first render, and React warns —
 * then leaves the tree stuck on its fallback — when a component suspends inside
 * an act scope that was never awaited, which is exactly what plain `render()`
 * is. The result is an ordinary `RenderResult`.
 */
export async function renderSuspending(ui: ReactNode): Promise<RenderResult> {
  let result: RenderResult | undefined

  await act(async () => {
    result = render(<>{ui}</>)
    // Yielding inside the act scope is what lets a suspended load settle before
    // the caller inspects the tree.
    await Promise.resolve()
  })

  if (!result) throw new Error('renderSuspending produced no result')
  return result
}

export type RenderAppOptions = MfeTestEnvironmentOptions

export interface RenderedMfe extends RenderResult {
  readonly environment: MfeTestEnvironment
  dispose(): Promise<void>
}

function renderInto(environment: MfeTestEnvironment, ui: ReactNode): RenderedMfe {
  const result = render(<MfeProvider runtime={environment.runtime}>{ui}</MfeProvider>)

  return {
    ...result,
    environment,
    dispose: async () => {
      result.unmount()
      await environment.dispose()
    },
  }
}

/**
 * Renders a real App definition through the same adapter production uses, with a
 * test-owned memory history. No global History patch is involved.
 */
export function renderApp(definition: AppDefinition, options: RenderAppOptions = {}): RenderedMfe {
  const environment = createMfeTestEnvironment({
    ...options,
    definitionId: definition.id,
    ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
    kind: 'app',
    basePath: options.basePath ?? '',
    definitions: [...(options.definitions ?? []), definition],
  })

  return renderInto(
    environment,
    <AppMount
      definition={definition}
      mount={environment.mount}
      bridge={environment.runtime.navigator}
    />,
  )
}

export interface RenderWidgetOptions extends MfeTestEnvironmentOptions {
  readonly props?: Readonly<Record<string, unknown>>
}

/** Renders a real Widget definition with the production validation path. */
export function renderWidget(
  definition: WidgetDefinition,
  options: RenderWidgetOptions = {},
): RenderedMfe {
  const environment = createMfeTestEnvironment({
    ...options,
    definitionId: definition.id,
    ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
    kind: 'widget',
    definitions: [...(options.definitions ?? []), definition],
  })

  const { inputs, handlers } = partitionWidgetProps(
    options.props ?? {},
    declaredEventNames(definition.contract),
  )

  return renderInto(
    environment,
    <WidgetMount
      definition={definition}
      mount={environment.mount}
      inputs={inputs}
      handlers={handlers}
      consumerEvents={definition.contract.events}
    />,
  )
}
