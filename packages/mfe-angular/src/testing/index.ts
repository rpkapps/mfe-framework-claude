/**
 * `@company/mfe-angular/testing` — author testing utilities, never imported by the production
 * entry and never supplying live credentials. The mount helpers call the definition's own
 * `mount`, the path a shell takes, over a runtime with nothing behind it but memory.
 */

import type { EnvironmentInjector, EnvironmentProviders } from '@angular/core'
import type { DefinitionKind, MfeError } from '@company/mfe-core'
import { applyScopeAttributes, createMountContext, type MountContext } from '@company/mfe-host'
import {
  createMemoryHostRuntime,
  type MemoryHostRuntime,
  type MemoryHostRuntimeOptions,
} from '@company/mfe-host/testing'

import type { AppDefinition, MfeDefinition, WidgetDefinition } from '../definition.ts'
import { provideMfeRuntime } from '../host/provide-runtime.ts'
import { resetMfeConfig as resetMfeConfigState } from './generated/config.ts'
import { resetMfeFetch as resetMfeFetchState } from './generated/fetch.ts'

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

export type MfeTestEnvironmentOptions = MemoryHostRuntimeOptions

export interface MfeTestEnvironment extends MemoryHostRuntime {
  /** `provideMfeRuntime(runtime)`, for a host component under test outside any mount. */
  readonly providers: EnvironmentProviders
}

/** Every environment is independent, so no singleton leaks state between tests. */
export function createMfeTestEnvironment(
  options: MfeTestEnvironmentOptions = {},
): MfeTestEnvironment {
  const memory = createMemoryHostRuntime(options)
  return { ...memory, providers: provideMfeRuntime(memory.runtime) }
}

interface PlacementOptions extends MfeTestEnvironmentOptions {
  /** Mounts into an environment the test owns, which the returned `dispose` leaves alive. */
  readonly environment?: MfeTestEnvironment
}

export interface MountedTestDefinition {
  /** The scope root the definition rendered into, attached to `document.body`. */
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
  readonly depth?: number
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
  readonly element: HTMLElement
  readonly host: HTMLElement
  readonly context: MountContext
  readonly environment: MfeTestEnvironment
  readonly teardown: () => Promise<void>
}

/** The element a host renders: a scope root in the document with the definition's element inside. */
function place(
  definition: MfeDefinition,
  kind: DefinitionKind,
  options: PlacementOptions & { readonly basePath?: string; readonly depth?: number },
): Placement {
  const ownsEnvironment = options.environment === undefined
  const environment =
    options.environment ??
    createMfeTestEnvironment({
      ...options,
      definitions: [...(options.definitions ?? []), definition],
      initialEntries: options.initialEntries ?? [options.basePath || '/'],
    })

  const handle = createMountContext({
    runtime: environment.runtime,
    definitionId: definition.id,
    ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
    kind,
    ...(options.basePath === undefined ? {} : { basePath: options.basePath }),
    ...(options.depth === undefined ? {} : { depth: options.depth }),
  })

  const element = document.createElement('div')
  applyScopeAttributes(element, {
    definitionId: definition.id,
    mountToken: handle.context.mountToken,
    kind,
  })
  const host = document.createElement('div')
  host.style.display = 'contents'
  element.appendChild(host)
  document.body.appendChild(element)

  return {
    element,
    host,
    context: handle.context,
    environment,
    teardown: async () => {
      await handle.dispose()
      element.remove()
      if (ownsEnvironment) environment.dispose()
    },
  }
}

/** A rejected mount leaves nothing behind: its context, element and environment go with it. */
async function orTeardown<T>(placement: Placement, mount: () => Promise<T>): Promise<T> {
  try {
    return await mount()
  } catch (error) {
    await placement.teardown()
    throw error
  }
}

/** Mounts a real App through its own `mount`, over a memory history starting at its boundary. */
export async function mountApp(
  definition: AppDefinition,
  options: MountAppOptions = {},
): Promise<MountedTestDefinition> {
  const placement = place(definition, 'app', options)
  const mounted = await orTeardown(placement, () =>
    definition.mount({ element: placement.host, context: placement.context }),
  )

  const dispose = async (): Promise<void> => {
    if (!live.delete(dispose)) return
    await mounted.dispose()
    await placement.teardown()
  }
  live.add(dispose)

  await mounted.whenStable()
  return {
    element: placement.element,
    environment: placement.environment,
    injector: mounted.injector,
    whenStable: () => mounted.whenStable(),
    dispose,
  }
}

/** Mounts a real Widget through its own `mount`, with the production validation on both sides. */
export async function mountWidget(
  definition: WidgetDefinition,
  options: MountWidgetOptions = {},
): Promise<MountedTestWidget> {
  const placement = place(definition, 'widget', options)
  const events: WidgetEvent[] = []
  const rejectedInputs: MfeError[] = []

  const mounted = await orTeardown(placement, () =>
    definition.mount({
      element: placement.host,
      context: placement.context,
      inputs: options.inputs ?? {},
      emit: (name, payload) => {
        events.push({ name, payload })
        options.onEvent?.(name, payload)
      },
      onInputRejected: error => {
        rejectedInputs.push(error)
      },
    }),
  )

  const dispose = async (): Promise<void> => {
    if (!live.delete(dispose)) return
    await mounted.dispose()
    await placement.teardown()
  }
  live.add(dispose)

  await mounted.whenStable()
  return {
    element: placement.element,
    environment: placement.environment,
    injector: mounted.injector,
    events,
    rejectedInputs,
    whenStable: () => mounted.whenStable(),
    update: async inputs => {
      mounted.update(inputs)
      await mounted.whenStable()
    },
    dispose,
  }
}
