/**
 * `@company/mfe-angular/testing` — author testing utilities, never imported by the production
 * entry and never supplying live credentials. The mount helpers place a definition through the
 * runtime's `mountDefinition` — the path every host takes — over a runtime with nothing behind it
 * but memory, so what a test mounts is exactly what a shell would.
 */

import {
  createComponent,
  EnvironmentInjector,
  getDebugNode,
  provideExperimentalZonelessChangeDetection,
  type ApplicationRef,
  type ComponentRef,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core'
import { createApplication } from '@angular/platform-browser'
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

/**
 * The runtime's own test surface: the memory runtime, its loader, bridge, storage and telemetry,
 * and the generated-alias fixtures with `resetGeneratedAliases`.
 */
export * from '@company/mfe-runtime/testing'

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

/**
 * Disposes every mount, host application and host element these helpers created that is still
 * there; the vitest setup calls it.
 */
export async function cleanup(): Promise<void> {
  for (const dispose of [...live]) await dispose()
}

/** Runs `release` once: when the returned function is called, or on `cleanup()` if it never is. */
function untilCleanup(release: () => void | Promise<void>): () => Promise<void> {
  const dispose = async (): Promise<void> => {
    if (!live.delete(dispose)) return
    await release()
  }
  live.add(dispose)
  return dispose
}

/**
 * An Angular application with no mount around it, which is where shell chrome and host components
 * live: zoneless, with the environment's runtime provided, as a shell boots one. `null` provides
 * no runtime. `cleanup()` destroys it.
 */
export async function createHostApplication(
  environment: MfeTestEnvironment | null,
  providers: readonly (Provider | EnvironmentProviders)[] = [],
): Promise<ApplicationRef> {
  const appRef = await createApplication({
    providers: [
      provideExperimentalZonelessChangeDetection(),
      ...(environment === null ? [] : [environment.providers]),
      ...providers,
    ],
  })
  untilCleanup(() => {
    if (!appRef.destroyed) appRef.destroy()
  })
  return appRef
}

export interface RenderedHost<T> {
  readonly ref: ComponentRef<T>
  /** The host component's element, attached to `document.body`. */
  readonly element: HTMLElement
}

/**
 * Renders `component` as a root view of the host application and waits for it to settle; `setup`
 * runs before the first change detection, so it decides what the first render binds. `cleanup()`
 * removes the element.
 */
export async function renderInHost<T>(
  appRef: ApplicationRef,
  component: Type<T>,
  setup: (instance: T) => void = () => undefined,
): Promise<RenderedHost<T>> {
  const element = document.createElement('div')
  document.body.appendChild(element)
  untilCleanup(() => {
    element.remove()
  })

  const ref = createComponent(component, {
    environmentInjector: appRef.injector,
    hostElement: element,
  })
  setup(ref.instance)
  appRef.attachView(ref.hostView)
  await appRef.whenStable()
  return { ref, element }
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
 * The mount's application injector, read from the root component the mount created inside the
 * runtime's target element: a component's injector reaches the environment injector its
 * application created it in. Read from the page because a host holds only the runtime's neutral
 * handle, which never exposes what a definition's `mount` resolved to.
 */
function applicationInjectorOf(scopeRoot: HTMLElement): EnvironmentInjector | undefined {
  const componentHost = scopeRoot.firstElementChild?.firstElementChild
  if (componentHost === null || componentHost === undefined) return undefined
  return (
    getDebugNode(componentHost)?.injector.get(EnvironmentInjector, undefined, {
      optional: true,
    }) ?? undefined
  )
}

/**
 * Settles with the mount: its Angular application once it is mounted, its error once it failed. A
 * failed mount is disposed first, so a rejection leaves nothing of it behind.
 */
async function settle(
  mount: DefinitionMount,
  placement: Placement,
): Promise<{ readonly element: HTMLElement; readonly injector: EnvironmentInjector }> {
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
  const injector = context === null ? undefined : applicationInjectorOf(context.scopeRoot)
  if (state.status === 'mounted' && context !== null && injector !== undefined) {
    return { element: context.scopeRoot, injector }
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
  return untilCleanup(async () => {
    await mount.dispose()
    placement.teardown()
  })
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

  const { element, injector } = await settle(mount, placement)
  const dispose = track(mount, placement)

  await mount.whenStable()
  return {
    element,
    environment: placement.environment,
    injector,
    whenStable: () => mount.whenStable(),
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

  const { element, injector } = await settle(mount, placement)
  const dispose = track(mount, placement)

  await mount.whenStable()
  return {
    element,
    environment: placement.environment,
    injector,
    events,
    rejectedInputs,
    whenStable: () => mount.whenStable(),
    update: async inputs => {
      mount.update(inputs)
      await mount.whenStable()
    },
    dispose,
  }
}
