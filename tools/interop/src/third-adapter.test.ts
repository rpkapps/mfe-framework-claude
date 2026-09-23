/**
 * Adapters are plugins. A third one — plain DOM, no framework, written here and nowhere else — is
 * registered beside the React and Angular adapters, reads its own registry entries, loads its
 * containers through the same federation loader, and its definitions are mounted by both
 * frameworks' hosts without a line of library code knowing it exists. One of its Apps then hosts a
 * React Widget itself, through `mountDefinition`, the way any host does.
 *
 * Everything the adapter needs comes from the published surfaces: the brand is the registered
 * symbol every adapter stamps, the registry adapter is the runtime's `createFederatedAdapter` given
 * nothing but the adapter's kind and its load hook, and the mount contract is the runtime's. The
 * runtime is reached through an adapter's `/host`, as an application reaches it, so this file
 * imports no package the application preset forbids.
 */

import { angularAdapter } from '@company/mfe-angular/registry'
import { DynamicWidget, lazyWidget } from '@company/mfe-react'
import {
  createFederatedAdapter,
  createFederationContainerLoader,
  createMfeRuntime,
  mountDefinition,
  type AppMountTarget,
  type CreateMfeRuntimeOptions,
  type FederationRuntime,
  type MfeRuntime,
  type MountableAppDefinition,
  type MountableWidgetDefinition,
  type MountedApp,
  type MountedWidget,
  type WidgetMountTarget,
} from '@company/mfe-react/host'
import { reactAdapter } from '@company/mfe-react/registry'
import {
  createMemoryNavigationBridge,
  createRecordingTelemetryProvider,
  renderSuspending,
} from '@company/mfe-react/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { z } from 'zod'

import {
  appHosts,
  expectedScope,
  expectReleased,
  overlayRootCount,
  placeInAngularHost,
  reactHostPage,
  scopeOf,
  scopesAround,
} from './__tests__/harness.ts'
import { counter, counterContract, counterRoots } from './fixtures/counter.ts'

type MfeAdapter = CreateMfeRuntimeOptions['adapters'][number]

// ---------------------------------------------------------------------------------------------
// The third adapter. Nothing below this line until the fixtures is known to any library package.
// ---------------------------------------------------------------------------------------------

const PLAIN_DOM = 'plain-dom'

/**
 * The registered symbol every adapter brands its definitions with. It is `Symbol.for` precisely so
 * a definition from any copy of any adapter is recognised, which is what lets an adapter the
 * libraries never heard of stamp it too. The assertion only names its type: TypeScript knows the
 * key as the core's `unique symbol`, which a value from `Symbol.for` cannot prove it is.
 */
type DefinitionBrand = Extract<keyof MountableAppDefinition, symbol>
const DEFINITION_BRAND: DefinitionBrand = Symbol.for('@company/mfe.definition') as DefinitionBrand

/**
 * What the adapter's `aroundLoad` saw, reset before every test: the container evaluating right
 * now, and every entry whose load it wrapped.
 */
const loadHook: { evaluating: string | null; wrapped: string[] } = {
  evaluating: null,
  wrapped: [],
}

/** Marks `id` as the container evaluating now, until the returned function is called. */
function enterLoad(id: string): () => void {
  loadHook.wrapped.push(id)
  loadHook.evaluating = id
  return () => {
    loadHook.evaluating = null
  }
}

/** Reads the entries whose `mfe.framework` names this adapter, as every federation adapter does. */
const plainDomAdapter = createFederatedAdapter({
  kind: PLAIN_DOM,
  async aroundLoad(load, entry) {
    const leave = enterLoad(entry.id)
    try {
      return await load()
    } finally {
      leave()
    }
  },
}) satisfies MfeAdapter

/** What a plain-DOM Widget's author writes: draw into the element, and redraw or clean up on request. */
interface PlainDomWidgetView<I> {
  update(inputs: I): void
  dispose(): void
}

/**
 * A Widget whose whole framework is `mount`. The adapter's part is the provider's half of the
 * boundary: it validates inputs and every payload against the Widget's own contract.
 */
function createPlainDomWidget<I>(options: {
  readonly id: string
  readonly version: string
  readonly inputs: z.ZodType<I>
  readonly events: Record<string, z.ZodType>
  readonly mount: (
    element: HTMLElement,
    inputs: I,
    emit: WidgetMountTarget['emit'],
  ) => PlainDomWidgetView<I>
}): MountableWidgetDefinition {
  const contract = { inputs: options.inputs, events: options.events }

  const mount = (target: WidgetMountTarget): MountedWidget => {
    const emit: WidgetMountTarget['emit'] = (event, payload) => {
      target.emit(event, contract.events[event]?.parse(payload) ?? payload)
    }
    const view = options.mount(target.element, options.inputs.parse(target.inputs), emit)

    return {
      update: inputs => {
        view.update(options.inputs.parse(inputs))
      },
      dispose: () => {
        view.dispose()
        target.element.replaceChildren()
        return Promise.resolve()
      },
    }
  }

  return {
    [DEFINITION_BRAND]: true,
    kind: 'widget',
    id: options.id,
    version: options.version,
    framework: PLAIN_DOM,
    contract,
    mount: target => Promise.resolve(mount(target)),
  }
}

/** An App whose whole framework is `mount`, given the target the runtime prepared. */
function createPlainDomApp(options: {
  readonly id: string
  readonly version: string
  readonly mount: (target: AppMountTarget) => MountedApp
}): MountableAppDefinition {
  return {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    id: options.id,
    version: options.version,
    framework: PLAIN_DOM,
    contributesBreadcrumbs: false,
    mount: target => Promise.resolve(options.mount(target)),
  }
}

// ---------------------------------------------------------------------------------------------
// Fixtures: two plain-DOM definitions and one React Widget, published as three containers.
// ---------------------------------------------------------------------------------------------

/** What the plain-DOM Widget went through, reset before every test. */
const seen = { tallyMounts: 0, liveTallies: 0 }

beforeEach(() => {
  seen.tallyMounts = 0
  seen.liveTallies = 0
  loadHook.evaluating = null
  loadHook.wrapped = []
})

/** The plain-DOM Widget has the same contract as the React counter, and draws the same button. */
const tally = createPlainDomWidget({
  id: 'tally',
  version: '1.0.0',
  ...counterContract,
  mount: (element, first, emit) => {
    seen.tallyMounts += 1
    seen.liveTallies += 1
    const button = document.createElement('button')
    button.type = 'button'
    element.append(button)

    const draw = (inputs: typeof first): void => {
      button.textContent = `${inputs.label}: ${String(inputs.count)}`
      button.onclick = () => {
        emit('bumped', { count: inputs.count + 1 })
      }
    }
    draw(first)

    return {
      update: draw,
      dispose: () => {
        seen.liveTallies -= 1
      },
    }
  },
})

/**
 * A plain-DOM App: a heading that follows the runtime's navigator, and a React Widget it places
 * with `mountDefinition` as its child, handing the Widget's own count back down on every event.
 */
const notes = createPlainDomApp({
  id: 'notes',
  version: '0.3.0',
  mount: ({ element, context }) => {
    const { runtime } = context
    const heading = document.createElement('h1')
    const lastEvent = document.createElement('p')
    lastEvent.textContent = 'no event yet'
    const slot = document.createElement('div')
    element.append(heading, lastEvent, slot)

    const showLocation = (pathname: string): void => {
      heading.textContent = `Notes at ${pathname.slice(context.basePath.length) || '/'} (depth ${String(context.depth)})`
    }
    showLocation(runtime.navigator.read().pathname)
    const stopFollowing = runtime.navigator.subscribe(location => {
      showLocation(location.pathname)
    })

    const nested = mountDefinition({
      runtime,
      element: slot,
      definitionId: 'counter',
      kind: 'widget',
      parent: context,
      inputs: { label: 'Nested', count: 1 },
      onEvent: (event, payload) => {
        const { count } = counterContract.events.bumped.parse(payload)
        lastEvent.textContent = `${event} to ${String(count)}`
        nested.update({ label: 'Nested', count })
      },
    })

    return {
      dispose: async () => {
        stopFollowing()
        await nested.dispose()
        element.replaceChildren()
      },
    }
  },
})

/** The registry as three builds would publish it: two plain-DOM containers and a React one. */
const registryEntries = [
  {
    id: 'tally',
    kind: 'widget',
    mfe: { contractMajor: 1, framework: PLAIN_DOM },
    manifestUrl: 'https://cdn.example.test/tally/mf-manifest.json',
    container: 'plain_tally',
    shareScopes: ['default', 'plain-dom@1.0.0'],
    version: '1.0.0',
    contract: { events: ['bumped'] },
  },
  {
    id: 'notes',
    kind: 'app',
    mfe: { contractMajor: 1, framework: PLAIN_DOM },
    manifestUrl: 'https://cdn.example.test/notes/mf-manifest.json',
    container: 'plain_notes',
    version: '0.3.0',
  },
  {
    id: 'counter',
    kind: 'widget',
    mfe: { contractMajor: 1, framework: 'react' },
    manifestUrl: 'https://cdn.example.test/counter/mf-manifest.json',
    container: 'react_counter',
    shareScopes: ['default', 'react@19.3.0'],
    version: '2.0.0',
    contract: { events: ['bumped'] },
  },
]

/** What each exposed module evaluates to, and which adapter hook was running when it did. */
const exposedModules: Readonly<Record<string, () => unknown>> = {
  'plain_tally/widgets/tally': () => ({ tally }),
  'plain_notes/app': () => ({ notes }),
  'react_counter/widgets/counter': () => ({ counter }),
}

interface FakeFederation {
  readonly runtime: FederationRuntime
  readonly registered: { name: string; entry: string; shareScope: string[] }[]
  /** Each exposed module evaluated, with the entry `aroundLoad` was wrapping at that moment. */
  readonly evaluated: { id: string; underHookFor: string | null }[]
}

/** Stands in for Module Federation's runtime: the loader hands it exactly what a page would. */
function createFakeFederation(): FakeFederation {
  const registered: FakeFederation['registered'] = []
  const evaluated: FakeFederation['evaluated'] = []

  return {
    registered,
    evaluated,
    runtime: {
      registerRemotes: remotes => {
        registered.push(...remotes.map(remote => ({ ...remote })))
      },
      loadRemote: async <T>(id: string): Promise<T | null> => {
        // A remote module evaluates after its chunk arrives, never synchronously.
        await Promise.resolve()
        const evaluate = exposedModules[id]
        if (evaluate === undefined) throw new Error(`No exposed module ${id}`)
        evaluated.push({ id, underHookFor: loadHook.evaluating })
        return evaluate() as T
      },
    },
  }
}

/**
 * A page built the way a shell boots one: raw entries read through every adapter it lists, and
 * the production federation loader over a fake federation runtime.
 */
function createPage(initialEntries: readonly string[] = ['/']): {
  readonly runtime: MfeRuntime
  readonly federation: FakeFederation
} {
  const federation = createFakeFederation()
  const handle = createMfeRuntime({
    registryEntries,
    adapters: [reactAdapter, angularAdapter, plainDomAdapter],
    loader: createFederationContainerLoader({ runtime: federation.runtime }),
    shellState: { user: { id: 'test-user', name: 'Test User' }, groups: [], theme: 'light' },
    telemetryProvider: createRecordingTelemetryProvider(),
    navigationBridge: createMemoryNavigationBridge(initialEntries),
    sessionGeneration: 'third-adapter',
  })
  onTestFinished(() => {
    handle.dispose()
  })
  return { runtime: handle.runtime, federation }
}

// ---------------------------------------------------------------------------------------------

describe('a third adapter, registered beside React and Angular', () => {
  it('reads its own entries, and neither other adapter claims one', () => {
    const { runtime } = createPage()

    expect(runtime.registry.rejected).toEqual([])
    expect(runtime.registry.entries.get('tally')).toMatchObject({
      adapter: PLAIN_DOM,
      definitionKind: 'widget',
      container: 'plain_tally',
      contract: { events: ['bumped'] },
    })
    expect(runtime.registry.entries.get('notes')).toMatchObject({
      adapter: PLAIN_DOM,
      definitionKind: 'app',
    })
    expect(runtime.registry.entries.get('counter')?.adapter).toBe('react')
    for (const raw of registryEntries.filter(entry => entry.mfe.framework === PLAIN_DOM)) {
      expect(reactAdapter.detect(raw)).toBe(false)
      expect(angularAdapter.detect(raw)).toBe(false)
    }
  })
})

type TallyProps = {
  readonly label: string
  readonly count: number
  readonly onBumped?: (payload: { readonly count: number }) => void
}

const Tally = lazyWidget('tally', { contract: counterContract })

/** The two ways a React host places a Widget; each has to mount the plain-DOM one. */
const reactPlacements: readonly (readonly [string, (props: TallyProps) => ReactNode])[] = [
  ['DynamicWidget', props => h(DynamicWidget, { widgetId: 'tally', ...props })],
  ['lazyWidget with a consumer contract', props => h(Tally, props)],
]

describe.each(reactPlacements)('a plain-DOM Widget placed by React’s %s', (_placement, place) => {
  it('is loaded through federation, inside its adapter’s load hook, and mounted in its scope', async () => {
    const { runtime, federation } = createPage()

    await renderSuspending(reactHostPage(runtime, place({ label: 'Clicks', count: 1 })))

    const button = await screen.findByRole('button', { name: 'Clicks: 1' })
    expect(scopeOf(button)).toEqual(expectedScope('tally', 'widget'))
    expect(federation.registered).toEqual([
      {
        name: 'plain_tally',
        entry: 'https://cdn.example.test/tally/mf-manifest.json',
        shareScope: ['default', 'plain-dom@1.0.0'],
      },
    ])
    expect(federation.evaluated).toEqual([
      { id: 'plain_tally/widgets/tally', underHookFor: 'tally' },
    ])
    expect(loadHook.wrapped).toEqual(['tally'])
    expect(seen.tallyMounts).toBe(1)
  })

  it('delivers its events to the handler prop, and a changed input back into it', async () => {
    const { runtime } = createPage()
    const onBumped = vi.fn()
    const page = (count: number): ReactNode =>
      reactHostPage(runtime, place({ label: 'Clicks', count, onBumped }))
    const view = await renderSuspending(page(1))

    fireEvent.click(await screen.findByRole('button', { name: 'Clicks: 1' }))

    expect(onBumped).toHaveBeenCalledExactlyOnceWith({ count: 2 })

    view.rerender(page(2))

    await screen.findByRole('button', { name: 'Clicks: 2' })
    expect(seen.tallyMounts).toBe(1)
  })

  it('is disposed with everything it held when the React host unmounts it', async () => {
    const { runtime } = createPage()
    const view = await renderSuspending(
      reactHostPage(runtime, place({ label: 'Clicks', count: 1 })),
    )
    await screen.findByRole('button', { name: 'Clicks: 1' })
    expect(overlayRootCount()).toBe(1)

    view.unmount()

    await waitFor(() => {
      expect(seen.liveTallies).toBe(0)
    })
    expectReleased(runtime)
  })
})

describe('a plain-DOM Widget placed by Angular’s <mfe-widget>', () => {
  it('mounts, delivers its events to (event), takes changed inputs and is disposed', async () => {
    const { runtime, federation } = createPage()
    const { ref, element } = await placeInAngularHost(runtime, 'tally', {
      label: 'Clicks',
      count: 1,
    })

    const button = await within(element).findByRole('button', { name: 'Clicks: 1' })
    expect(scopeOf(button)).toEqual(expectedScope('tally', 'widget'))
    expect(federation.evaluated).toEqual([
      { id: 'plain_tally/widgets/tally', underHookFor: 'tally' },
    ])

    fireEvent.click(button)
    expect(ref.instance.events).toEqual([{ name: 'bumped', payload: { count: 2 } }])

    ref.instance.inputs.set({ label: 'Clicks', count: 2 })
    await within(element).findByRole('button', { name: 'Clicks: 2' })
    expect(seen.tallyMounts).toBe(1)

    ref.instance.shown.set(false)

    await waitFor(() => {
      expect(seen.liveTallies).toBe(0)
    })
    expectReleased(runtime)
    expect(ref.instance.failures).toEqual([])
  })
})

/**
 * Each framework's App host places the plain-DOM App, which places a React Widget in turn: the
 * third adapter's definitions sit between two framework hosts in either direction.
 */
describe.each(appHosts)('a plain-DOM App placed by %s', (_host, host) => {
  const place = (runtime: MfeRuntime) => host(runtime, 'notes', '/notes')

  it('mounts at its boundary and follows the page through the runtime’s navigator', async () => {
    const { runtime } = createPage(['/notes/today'])
    const { container, failures } = await place(runtime)

    const heading = await within(container).findByRole('heading', {
      name: 'Notes at /today (depth 1)',
    })
    expect(scopeOf(heading)).toEqual(expectedScope('notes', 'app'))
    expect(failures).toEqual([])

    runtime.navigator.push('/notes/yesterday')
    runtime.navigator.push('/notes/tomorrow')
    runtime.navigator.back()

    await within(container).findByRole('heading', { name: 'Notes at /yesterday (depth 1)' })
  })

  it('hosts a React Widget through mountDefinition, one level deeper, with events both ways', async () => {
    const { runtime, federation } = createPage(['/notes'])
    const { container } = await place(runtime)

    const button = await within(container).findByRole('button', { name: 'Nested: 1' })
    expect(scopesAround(button)).toEqual([
      expectedScope('counter', 'widget'),
      expectedScope('notes', 'app'),
    ])
    expect(counterRoots.live).toBe(1)

    fireEvent.click(button)

    await within(container).findByText('bumped to 2')
    await within(container).findByRole('button', { name: 'Nested: 2' })
    // The React container loaded outside the plain-DOM adapter's hook; only its own load ran in it.
    expect(federation.evaluated).toEqual([
      { id: 'plain_notes/app', underHookFor: 'notes' },
      { id: 'react_counter/widgets/counter', underHookFor: null },
    ])
    expect(loadHook.wrapped).toEqual(['notes'])
  })

  it('leaves nothing of either level behind once its host removes it', async () => {
    const { runtime } = createPage(['/notes'])
    const { container, remove } = await place(runtime)
    await within(container).findByRole('button', { name: 'Nested: 1' })
    expect(overlayRootCount()).toBe(2)

    remove()

    await waitFor(() => {
      expect(counterRoots.live).toBe(0)
    })
    await waitFor(() => {
      expect(overlayRootCount()).toBe(0)
    })
    expectReleased(runtime)
  })
})

describe('the third adapter’s load hook', () => {
  it('wraps each load that happens once, however many hosts wait on it', async () => {
    const { runtime, federation } = createPage()

    await renderSuspending(
      reactHostPage(
        runtime,
        h(
          'div',
          null,
          h(DynamicWidget, { widgetId: 'tally', label: 'First', count: 1 }),
          h(Tally, { label: 'Second', count: 1 }),
        ),
      ),
    )

    await screen.findByRole('button', { name: 'First: 1' })
    await screen.findByRole('button', { name: 'Second: 1' })
    expect(loadHook.wrapped).toEqual(['tally'])
    expect(federation.evaluated).toHaveLength(1)
    expect(seen.tallyMounts).toBe(2)
  })
})
