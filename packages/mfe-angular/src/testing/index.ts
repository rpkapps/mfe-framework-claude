/**
 * `@company/mfe-angular/testing` — author testing utilities, never imported by the production
 * entry and never supplying live credentials. The mount helpers place a definition through the
 * runtime's `mountDefinition` — the path every host takes — over a runtime with nothing behind it
 * but memory, so what a test mounts is exactly what a shell would.
 */

import type { EnvironmentInjector, EnvironmentProviders } from '@angular/core'
import { createMfeError, type MfeError } from '@company/mfe-core'
import {
  mountDefinition,
  type DefinitionMount,
  type WidgetDefinitionMount,
} from '@company/mfe-runtime'
import {
  createMemoryRuntime,
  type MemoryRuntime,
  type MemoryRuntimeOptions,
} from '@company/mfe-runtime/testing'

import type { AppDefinition, MfeDefinition, WidgetDefinition } from '../definition.ts'
import { provideMfeRuntime } from '../host/provide-runtime.ts'
import { mountedApplicationOf, type MountedApplication } from '../mount/mounted-applications.ts'
import { resetMfeConfig as resetMfeConfigState } from './generated/config.ts'
import { resetMfeFetch as resetMfeFetchState } from './generated/fetch.ts'

/** The runtime's own test surface: the memory runtime, its loader, bridge, storage and telemetry. */
export * from '@company/mfe-runtime/testing'

/**
 * The generated-alias fixtures, which a container's vitest config points `#mfe/config` and
 * `#mfe/fetch` at. The source under test keeps its production imports; nothing here is a second
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

/** Everything the aliases hold, cleared; the shared vitest setup calls it. */
export function resetGeneratedAliases(): void {
  resetMfeConfigState()
  resetMfeFetchState()
}

export type MfeTestEnvironmentOptions = MemoryRuntimeOptions

export interface MfeTestEnvironment extends MemoryRuntime {
  /** `provideMfeRuntime(runtime)`, for a host component under test outside any mount. */
  readonly providers: EnvironmentProviders
}

/** Every environment is independent, so no singleton leaks state between tests. */
export function createMfeTestEnvironment(
  options: MfeTestEnvironmentOptions = {},
): MfeTestEnvironment {
  const memory = createMemoryRuntime(options)
  return { ...memory, providers: provideMfeRuntime(memory.runtime) }
}

interface PlacementOptions extends MfeTestEnvironmentOptions {
  /**
   * Mounts into an environment the test owns, which the returned `dispose` leaves alive. It has
   * to list the definition among its `definitions`, as a shell's registry lists what it mounts.
   */
  readonly environment?: MfeTestEnvironment
}

export interface MountedTestDefinition {
  /** The scope root the runtime created for the mount, attached to `document.body`. */
  readonly element: HTMLElement
  readonly environment: MfeTestEnvironment
  /** The mount's application injector, where an App's `Router` lives. */
  readonly injector: EnvironmentInjector
  /** Resolves once zoneless change detection has nothing left to do. */
  whenStable(): Promise<void>
  dispose(): Promise<void>
}

export interface MountAppOptions extends PlacementOptions {
  /** The boundary the App is mounted at; the memory history starts there unless told otherwise. */
  readonly basePath?: string
}

export interface WidgetEvent {
  readonly name: string
  readonly payload: unknown
}

export interface MountWidgetOptions extends PlacementOptions {
  readonly inputs?: Readonly<Record<string, unknown>>
  readonly onEvent?: (name: string, payload: unknown) => void
}

export interface MountedTestWidget extends MountedTestDefinition {
  /** Every event the Widget emitted and its contract accepted, in order. */
  readonly events: readonly WidgetEvent[]
  /** Every later input set the Widget rejected, in order. */
  readonly rejectedInputs: readonly MfeError[]
  /** Replaces the inputs and waits for the Widget to render them. */
  update(inputs: Readonly<Record<string, unknown>>): Promise<void>
}

/** What a test forgot to dispose, disposed by `cleanup()` so nothing leaks into the next test. */
const live = new Set<() => Promise<void>>()

/** Disposes every mount these helpers created that is still mounted; the vitest setup calls it. */
export async function cleanup(): Promise<void> {
  for (const dispose of [...live]) await dispose()
}

interface Placement {
  readonly environment: MfeTestEnvironment
  /** The element a host renders and hands the runtime, attached to `document.body`. */
  readonly host: HTMLElement
  /** Removes the host element, and the environment when the helper created it. */
  readonly teardown: () => void
}

function place(definition: MfeDefinition, options: PlacementOptions, basePath: string): Placement {
  const ownsEnvironment = options.environment === undefined
  const environment =
    options.environment ??
    createMfeTestEnvironment({
      ...options,
      definitions: [...(options.definitions ?? []), definition],
      initialEntries: options.initialEntries ?? [basePath || '/'],
    })

  if (!environment.runtime.registry.entries.has(definition.id)) {
    throw createMfeError({
      code: 'registry/invalid-entry',
      id: definition.id,
      operation: 'mount into a test environment',
      expected: `"${definition.id}" among the environment's definitions`,
      observed: 'an environment whose registry does not list it',
      repair:
        'List the definition in createMfeTestEnvironment({ definitions }), or leave out `environment`.',
    })
  }

  const host = document.createElement('div')
  document.body.appendChild(host)

  return {
    environment,
    host,
    teardown: () => {
      host.remove()
      if (ownsEnvironment) environment.dispose()
    },
  }
}

/**
 * Settles with the mount: its Angular application once it is mounted, its error once it failed. A
 * failed mount is disposed first, so a rejection leaves nothing of it behind.
 */
async function settle(
  mount: DefinitionMount,
  placement: Placement,
): Promise<{ readonly element: HTMLElement; readonly application: MountedApplication }> {
  const state = await new Promise<ReturnType<DefinitionMount['getState']>>(resolve => {
    const check = (): boolean => {
      const current = mount.getState()
      if (current.status === 'pending') return false
      resolve(current)
      return true
    }
    if (check()) return
    const unsubscribe = mount.subscribe(() => {
      if (check()) unsubscribe()
    })
  })

  const context = mount.context
  const application = context === null ? undefined : mountedApplicationOf(context)
  if (state.status === 'mounted' && context !== null && application !== undefined) {
    return { element: context.scopeRoot, application }
  }

  // Its failure is the rejection; a cleanup failure has reached the environment's diagnostics.
  await mount.dispose().catch(() => undefined)
  placement.teardown()
  if (state.status === 'error') throw state.error
  throw createMfeError({
    code: 'mount/failure',
    id: mount.id,
    operation: 'mount into a test environment',
    expected: 'a mounted Angular definition',
    observed:
      state.status === 'disposed'
        ? 'a mount disposed before it settled'
        : 'a mount that created no Angular application',
    repair: 'Mount only definitions created with createApp or createWidget from this package.',
  })
}

function track(mount: DefinitionMount, placement: Placement): () => Promise<void> {
  const dispose = async (): Promise<void> => {
    if (!live.delete(dispose)) return
    await mount.dispose()
    placement.teardown()
  }
  live.add(dispose)
  return dispose
}

/** Mounts a real App through the runtime, over a memory history starting at its boundary. */
export async function mountApp(
  definition: AppDefinition,
  options: MountAppOptions = {},
): Promise<MountedTestDefinition> {
  const basePath = options.basePath ?? ''
  const placement = place(definition, options, basePath)
  const mount = mountDefinition({
    runtime: placement.environment.runtime,
    element: placement.host,
    definitionId: definition.id,
    kind: 'app',
    basePath,
  })

  const { element, application } = await settle(mount, placement)
  const dispose = track(mount, placement)

  await application.whenStable()
  return {
    element,
    environment: placement.environment,
    injector: application.injector,
    whenStable: () => application.whenStable(),
    dispose,
  }
}

/** Mounts a real Widget through the runtime, with the production validation on both sides. */
export async function mountWidget(
  definition: WidgetDefinition,
  options: MountWidgetOptions = {},
): Promise<MountedTestWidget> {
  const placement = place(definition, options, '')
  const events: WidgetEvent[] = []
  const rejectedInputs: MfeError[] = []

  const mount: WidgetDefinitionMount = mountDefinition({
    runtime: placement.environment.runtime,
    element: placement.host,
    definitionId: definition.id,
    kind: 'widget',
    inputs: options.inputs ?? {},
    onEvent: (name, payload) => {
      events.push({ name, payload })
      options.onEvent?.(name, payload)
    },
    onInputRejected: error => {
      rejectedInputs.push(error)
    },
  })

  const { element, application } = await settle(mount, placement)
  const dispose = track(mount, placement)

  await application.whenStable()
  return {
    element,
    environment: placement.environment,
    injector: application.injector,
    events,
    rejectedInputs,
    whenStable: () => application.whenStable(),
    update: async inputs => {
      mount.update(inputs)
      await application.whenStable()
    },
    dispose,
  }
}
