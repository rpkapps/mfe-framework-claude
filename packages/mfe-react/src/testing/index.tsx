/**
 * `@company/mfe-react/testing` — supported author testing utilities, never imported by the
 * production entry and never supplying live credentials.
 *
 * Two ways to put a definition on the page. `renderApp` and `renderWidget` render its tree in the
 * test's own React tree: fast, synchronous and made for Testing Library, and the tree they render
 * is the `MountTree` a production mount renders. `mountApp` and `mountWidget` place it the way a
 * host does, through the runtime's `mountDefinition` and the definition's own `mount`, for a test
 * about loading, retry, disposal or anything else the host decides.
 */

import {
  withoutUndefined,
  type Diagnostic,
  type MfeError,
  type ShellTheme,
  type ShellUser,
} from '@company/mfe-core'
import {
  createMountContext,
  mountDefinition,
  type DefinitionMount,
  type MountableAppDefinition,
  type MountableWidgetDefinition,
} from '@company/mfe-runtime'
import {
  createMemoryRuntime,
  type MemoryRuntime,
  type MemoryRuntimeOptions,
  type MemoryStorageArea,
  type RecordingTelemetryProvider,
} from '@company/mfe-runtime/testing'
import { act, render, waitFor, type RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'

import { createRouterContext } from '../app-mount.tsx'
import type { AppDefinition, WidgetDefinition } from '../definition.ts'
import { MfeMountProvider } from '../mount-context.tsx'
import { MountTree } from '../mount-tree.tsx'
import type { MfeRouterContext } from '../router-contract.ts'
import { MfeProvider } from '../runtime-context.tsx'
import { withQueryClient, type MfeMount, type MfeRuntime } from '../runtime.ts'
import { deliverWidgetOutput, widgetInputs } from '../widget-props.ts'

/**
 * The runtime's memory fakes and the generated-alias fixtures, so a test imports its adapter's
 * `/testing` and nothing else.
 */
export * from '@company/mfe-runtime/testing'

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
  /** Definitions the in-process loader can resolve, by id, whichever adapter built them. */
  readonly definitions?: MemoryRuntimeOptions['definitions']
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
  readonly navigation: MemoryRuntime['navigation']
  /** The injected browser stores, which count the calls made against them. */
  readonly storageAreas: {
    readonly local: MemoryStorageArea
    readonly session: MemoryStorageArea
  }
  dispose(): Promise<void>
}

/** Only the options a memory runtime reads, so an absent one stays absent. */
function memoryOptions(options: MfeTestEnvironmentOptions): MemoryRuntimeOptions {
  return withoutUndefined({
    shellState: options.shellState,
    definitions: options.definitions,
    initialEntries: options.initialEntries,
    sessionGeneration: options.sessionGeneration,
  })
}

/**
 * The runtime's memory runtime plus what is React's: a mount with its Query client, the providers,
 * and the router context. Every environment is independent, so no module state leaks between
 * tests.
 */
export function createMfeTestEnvironment(
  options: MfeTestEnvironmentOptions = {},
): MfeTestEnvironment {
  const memory = createMemoryRuntime(memoryOptions(options))
  const { runtime } = memory

  const handle = createMountContext({
    runtime,
    definitionId: options.definitionId ?? 'test-definition',
    ...withoutUndefined({ definitionVersion: options.definitionVersion }),
    kind: options.kind ?? 'app',
    ...withoutUndefined({ basePath: options.basePath }),
  })
  const mount = withQueryClient(handle.context)

  return {
    runtime,
    mount,
    wrapper: ({ children }) => (
      <MfeProvider runtime={runtime}>
        <MfeMountProvider mount={mount}>{children}</MfeMountProvider>
      </MfeProvider>
    ),
    routerContext: createRouterContext(mount),
    // Wrapped in `act` so updates land inside the test's normal React boundary.
    setShellState: patch => {
      act(() => {
        memory.setShellState(patch)
      })
    },
    telemetry: memory.telemetry,
    diagnostics: memory.diagnostics,
    navigation: memory.navigation,
    storageAreas: memory.storageAreas,
    dispose: async () => {
      await handle.dispose()
      memory.dispose()
    },
  }
}

/**
 * Renders a tree that may suspend, inside an awaited act scope: React warns and leaves the tree
 * stuck on its fallback when a component suspends inside an act scope that was never awaited.
 */
export async function renderSuspending(ui: ReactNode): Promise<RenderResult> {
  let result: RenderResult | undefined

  await act(async () => {
    result = render(<>{ui}</>)
    // Yielding inside the act scope lets a suspended load settle before the caller looks.
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

/**
 * Renders into the mount's own scope root, placed in the document the way the runtime places it
 * for a production mount, so a scoped selector and `useScopeRoot` see what they would see there.
 */
function renderInto(environment: MfeTestEnvironment, ui: ReactNode): RenderedMfe {
  const { scopeRoot } = environment.mount
  document.body.appendChild(scopeRoot)
  const result = render(ui, { container: scopeRoot })

  return {
    ...result,
    environment,
    dispose: async () => {
      result.unmount()
      scopeRoot.remove()
      await environment.dispose()
    },
  }
}

/** Renders a real App through the tree production renders, over a test-owned memory history. */
export function renderApp(definition: AppDefinition, options: RenderAppOptions = {}): RenderedMfe {
  const environment = createMfeTestEnvironment({
    ...options,
    definitionId: definition.id,
    ...withoutUndefined({ definitionVersion: definition.version }),
    kind: 'app',
    basePath: options.basePath ?? '',
    definitions: [...(options.definitions ?? []), definition],
  })

  return renderInto(environment, <MountTree definition={definition} mount={environment.mount} />)
}

export interface RenderWidgetOptions extends MfeTestEnvironmentOptions {
  /** Inputs and `onX` handlers, split exactly as a host splits a consumer's props. */
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
    ...withoutUndefined({ definitionVersion: definition.version }),
    kind: 'widget',
    definitions: [...(options.definitions ?? []), definition],
  })
  const props = options.props ?? {}

  return renderInto(
    environment,
    <MountTree
      definition={definition}
      mount={environment.mount}
      inputs={widgetInputs(props)}
      emit={(output, payload) => {
        deliverWidgetOutput(props, output, payload)
      }}
    />,
  )
}

interface PlacementOptions extends MemoryRuntimeOptions {
  /** Mounts into a runtime the test owns, which the returned `dispose` leaves alive. */
  readonly memory?: MemoryRuntime
}

export interface MountedTestDefinition {
  /** The scope root the runtime created for the mount, attached to `document.body`. */
  readonly element: HTMLElement
  readonly memory: MemoryRuntime
  /** The runtime's handle on the mount: its state, `retry` and `context`. */
  readonly mount: DefinitionMount
  /** Disposes the mount, removes the element, and disposes the runtime if it made it. */
  dispose(): Promise<void>
}

export interface MountAppOptions extends PlacementOptions {
  /** The boundary the App is mounted at; the memory history starts there unless told otherwise. */
  readonly basePath?: string
}

export interface WidgetOutput {
  readonly name: string
  readonly payload: unknown
}

export interface MountWidgetOptions extends PlacementOptions {
  readonly inputs?: Readonly<Record<string, unknown>>
  readonly onOutput?: (name: string, payload: unknown) => void
}

export interface MountedTestWidget extends MountedTestDefinition {
  /** Every output the Widget emitted and its contract accepted, in order. */
  readonly outputs: readonly WidgetOutput[]
  /** Every later input set the Widget rejected, in order. */
  readonly rejectedInputs: readonly MfeError[]
  /** Replaces the inputs, as a host re-rendering with new props does. */
  update(inputs: Readonly<Record<string, unknown>>): void
}

interface Placement {
  /** The element a host renders and hands the runtime, attached to `document.body`. */
  readonly host: HTMLElement
  readonly memory: MemoryRuntime
  /** Disposes the mount, removes the host element, and the runtime when this made it. */
  readonly teardown: (mount: DefinitionMount) => Promise<void>
}

function place(
  definition: MountableAppDefinition | MountableWidgetDefinition,
  { memory: provided, ...runtimeOptions }: PlacementOptions,
  basePath: string,
): Placement {
  const memory =
    provided ??
    createMemoryRuntime({
      ...runtimeOptions,
      definitions: [...(runtimeOptions.definitions ?? []), definition],
      initialEntries: runtimeOptions.initialEntries ?? [basePath || '/'],
    })

  const host = document.createElement('div')
  document.body.appendChild(host)

  return {
    host,
    memory,
    teardown: async mount => {
      await mount.dispose()
      host.remove()
      if (provided === undefined) memory.dispose()
    },
  }
}

/**
 * Resolves once the mount settled: with the mounted definition, or by rejecting with the error the
 * mount failed with, after disposing everything it made. Waits through Testing Library, which
 * lets a React root render on React's own scheduler while it polls.
 */
async function settled(mount: DefinitionMount, placement: Placement): Promise<HTMLElement> {
  await waitFor(() => {
    if (mount.state.status === 'pending') throw new Error(`${mount.id} is still mounting`)
  })

  const { state, context } = mount
  if (state.status === 'error') {
    await placement.teardown(mount)
    throw state.error
  }
  if (context === null) throw new Error(`${mount.id} settled without a mount context`)
  return context.scopeRoot
}

/** Mounts a real App the way every host does, over a memory history starting at its boundary. */
export async function mountApp(
  definition: MountableAppDefinition,
  options: MountAppOptions = {},
): Promise<MountedTestDefinition> {
  const { basePath = '', ...placementOptions } = options
  const placement = place(definition, placementOptions, basePath)
  const mount = mountDefinition({
    runtime: placement.memory.runtime,
    element: placement.host,
    definitionId: definition.id,
    kind: 'app',
    basePath,
  })

  const element = await settled(mount, placement)
  return {
    element,
    memory: placement.memory,
    mount,
    dispose: () => placement.teardown(mount),
  }
}

/** Mounts a real Widget the way every host does, with the production validation on both sides. */
export async function mountWidget(
  definition: MountableWidgetDefinition,
  options: MountWidgetOptions = {},
): Promise<MountedTestWidget> {
  const { inputs = {}, onOutput, ...placementOptions } = options
  const placement = place(definition, placementOptions, '')
  const outputs: WidgetOutput[] = []
  const rejectedInputs: MfeError[] = []

  const mount = mountDefinition({
    runtime: placement.memory.runtime,
    element: placement.host,
    definitionId: definition.id,
    kind: 'widget',
    inputs,
    onOutput: (name, payload) => {
      outputs.push({ name, payload })
      onOutput?.(name, payload)
    },
    onInputRejected: error => {
      rejectedInputs.push(error)
    },
  })

  const element = await settled(mount, placement)
  return {
    element,
    memory: placement.memory,
    mount,
    outputs,
    rejectedInputs,
    update: next => {
      mount.update(next)
    },
    dispose: () => placement.teardown(mount),
  }
}
