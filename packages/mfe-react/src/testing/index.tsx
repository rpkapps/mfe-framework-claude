/**
 * `@company/mfe-react/testing` — supported author testing utilities.
 *
 * This entry is never imported by the production entry and never reaches an
 * author's production bundle. It is for Vitest and React Testing Library, and
 * it is explicitly not a standalone interactive shell or a second
 * authentication system: it supplies isolated providers, explicit fixtures and
 * deterministic cleanup, and nothing else.
 *
 * A helper here never quietly supplies live credentials, and it does not claim
 * federation, CSS layout or real authenticated integration coverage. Those
 * remain browser tests against real builds.
 */

import {
  DEFAULT_DEADLINES,
  DiagnosticsHub,
  type Diagnostic,
  type ShellState,
  type ShellTheme,
  type ShellUser,
} from '@company/mfe-core'
import {
  BoundaryNavigator,
  BreadcrumbStore,
  CommandRegistry,
  createInProcessLoader,
  createMemoryNavigationBridge,
  createMemoryStorageArea,
  createRecordingTelemetryProvider,
  MfeStorageStore,
  requiresSessionRetirement,
  SharedContainerLoader,
  ShellStateStore,
  type LoadedDefinition,
  type RecordingTelemetryProvider,
} from '@company/mfe-host'
import { act, render, type RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'

import { AppMount } from '../app-mount.tsx'
import { createMount } from '../create-runtime.ts'
import { createRouterContext } from '../app-mount.tsx'
import { MfeProvider } from '../runtime-context.tsx'
import { MfeMountProvider } from '../mount-context.tsx'
import { WidgetMount, declaredEventNames, partitionWidgetProps } from '../widget-mount.tsx'
import type { AppDefinition, MfeDefinition, WidgetDefinition } from '../definition.ts'
import type { MfeRouterContext } from '../router-contract.ts'
import type { MfeMount, MfeRuntime } from '../runtime.ts'

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
  dispose(): Promise<void>
}

const DEFAULT_SHELL_STATE: ShellState = Object.freeze({
  user: Object.freeze({ id: 'test-user', name: 'Test User' }),
  groups: Object.freeze(['testers']),
  theme: 'light' as const,
})

/**
 * Builds a single simulated mount with explicit fixtures.
 *
 * Every environment is independent: separate stores, separate storage areas and
 * separate recorded telemetry, so no singleton leaks state between tests.
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
    user: options.shellState?.user ?? DEFAULT_SHELL_STATE.user,
    groups: options.shellState?.groups ?? DEFAULT_SHELL_STATE.groups,
    theme: options.shellState?.theme ?? DEFAULT_SHELL_STATE.theme,
  })

  const storage = new MfeStorageStore({
    areas: { local: createMemoryStorageArea(), session: createMemoryStorageArea() },
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
        [...loadable.keys()].map(id => [
          id,
          {
            id,
            definitionKind: loadable.get(id)?.identity.kind ?? 'app',
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

  // Generations are minted per transition so a test can exercise the real
  // fencing behaviour: records written under a retired generation must not come
  // back when the same user or group set returns.
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

  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <MfeProvider runtime={runtime}>
      <MfeMountProvider mount={handle.mount}>{children}</MfeMountProvider>
    </MfeProvider>
  )

  return {
    runtime,
    mount: handle.mount,
    wrapper,
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

export interface RenderAppOptions extends MfeTestEnvironmentOptions {
  readonly basePath?: string
}

export interface RenderedMfe extends RenderResult {
  readonly environment: MfeTestEnvironment
  dispose(): Promise<void>
}

/**
 * Renders a real App definition through the same adapter production uses, with
 * a test-owned memory history. No global History patch is involved.
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

  const result = render(
    <MfeProvider runtime={environment.runtime}>
      <AppMount
        definition={definition}
        mount={environment.mount}
        bridge={environment.runtime.navigator}
      />
    </MfeProvider>,
  )

  return {
    ...result,
    environment,
    dispose: async () => {
      result.unmount()
      await environment.dispose()
    },
  }
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

  const result = render(
    <MfeProvider runtime={environment.runtime}>
      <WidgetMount
        definition={definition}
        mount={environment.mount}
        inputs={inputs}
        handlers={handlers}
        consumerEvents={definition.contract.events}
      />
    </MfeProvider>,
  )

  return {
    ...result,
    environment,
    dispose: async () => {
      result.unmount()
      await environment.dispose()
    },
  }
}
