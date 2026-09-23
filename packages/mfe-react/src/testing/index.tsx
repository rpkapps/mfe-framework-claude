/**
 * `@company/mfe-react/testing` — supported author testing utilities, never imported by the
 * production entry and never supplying live credentials.
 */

import type { BrandedDefinition, Diagnostic, ShellTheme, ShellUser } from '@company/mfe-core'
import {
  createMemoryHostRuntime,
  type MemoryHostRuntime,
  type MemoryStorageArea,
  type RecordingTelemetryProvider,
} from '@company/mfe-runtime/testing'
import { act, render, type RenderResult } from '@testing-library/react'

import { resetMfeConfig as resetMfeConfigState } from './generated/config.ts'
import { resetMfeFetch as resetMfeFetchState } from './generated/fetch.ts'
import type { ReactNode } from 'react'

import { AppMount, createRouterContext } from '../app-mount.tsx'
import { createMount } from '../create-runtime.ts'
import { MfeProvider } from '../runtime-context.tsx'
import { MfeMountProvider } from '../mount-context.tsx'
import { WidgetMount, declaredEventNames, partitionWidgetProps } from '../widget-mount.tsx'
import type { AppDefinition, WidgetDefinition } from '../definition.ts'
import type { MfeRouterContext } from '../router-contract.ts'
import type { MfeMount, MfeRuntime } from '../runtime.ts'

/**
 * The generated-alias fixtures, which a container's vitest config points `#mfe/config` and
 * `#mfe/fetch` at. The source under test keeps its production imports (§14); nothing here is a
 * second configuration API.
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

/** Everything the aliases hold, cleared; the shared vitest setup calls it. */
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
  /** Definitions the in-process loader can resolve, by id, whichever adapter built them. */
  readonly definitions?: readonly BrandedDefinition[]
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
  readonly navigation: MemoryHostRuntime['navigation']
  /** The injected browser stores, which count the calls made against them. */
  readonly storageAreas: {
    readonly local: MemoryStorageArea
    readonly session: MemoryStorageArea
  }
  dispose(): Promise<void>
}

/**
 * The host's memory runtime plus what is React's: a mount with its Query client, the providers,
 * and the router context. Every environment is independent, so no singleton leaks state between
 * tests.
 */
export function createMfeTestEnvironment(
  options: MfeTestEnvironmentOptions = {},
): MfeTestEnvironment {
  const memory = createMemoryHostRuntime({
    ...(options.shellState === undefined ? {} : { shellState: options.shellState }),
    ...(options.definitions === undefined ? {} : { definitions: options.definitions }),
    ...(options.initialEntries === undefined ? {} : { initialEntries: options.initialEntries }),
    ...(options.sessionGeneration === undefined
      ? {}
      : { sessionGeneration: options.sessionGeneration }),
  })
  const { runtime } = memory

  const handle = createMount({
    runtime,
    definitionId: options.definitionId ?? 'test-definition',
    ...(options.definitionVersion === undefined
      ? {}
      : { definitionVersion: options.definitionVersion }),
    kind: options.kind ?? 'app',
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
 * Renders a tree that will suspend, inside an awaited act scope: React warns and leaves the tree
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

/** Renders a real App through the adapter production uses, over a test-owned memory history. */
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
