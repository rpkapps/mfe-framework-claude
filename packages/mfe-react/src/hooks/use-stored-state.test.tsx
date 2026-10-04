/**
 * `useStoredState` in both the positions it is legal in: the record's scope is decided by where
 * the component renders, and there is no second hook and no flag (§24). The key says which area
 * its value lives in; the hook returns the same shape for each.
 */

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, useEffect, useState, type ReactNode } from 'react'
import {
  createMfeError,
  HOST_SCOPE,
  storedKey,
  type Diagnostic,
  type StoredRow,
  type StoredValue,
  type UserStorageAdapter,
  type UserStorageState,
} from '@company/mfe-core'
import {
  createMfeRuntime,
  createMountContext,
  createNoopTelemetryProvider,
  DiagnosticsHub,
  type MfeRuntimeHandle,
  type StorageService,
} from '@company/mfe-runtime'
import { createInProcessLoader } from '@company/mfe-runtime/testing'
import { z } from 'zod'

import { MfeMountProvider } from '../mount-context.tsx'
import { reactAdapter } from '../registry/react-adapter.ts'
import { MfeProvider } from '../runtime-context.tsx'
import { withQueryClient, type MfeMount } from '../runtime.ts'
import {
  createMemoryUserStorage,
  createMfeTestEnvironment,
  type MfeTestEnvironment,
  type MfeTestEnvironmentOptions,
} from '../testing/index.tsx'
import { useStoredState, type StoredState } from './use-stored-state.ts'

type ShellTheme = 'light' | 'dark'

const themeSchema = z.enum(['light', 'dark'])
const themeKey = storedKey('theme', themeSchema.default('dark'))
const densityKey = storedKey('density', z.enum(['comfortable', 'compact']).default('comfortable'))

interface Wired {
  readonly handle: MfeRuntimeHandle
  readonly storage: StorageService
  readonly reported: Diagnostic[]
}

let wired: Wired | null = null
let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = wired
  wired = null
  current?.handle.dispose()
  const env = environment
  environment = null
  await env?.dispose()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

/** The boot sequence a shell actually writes: hub, then the runtime. */
function wire(): Wired {
  const reported: Diagnostic[] = []
  const diagnostics = new DiagnosticsHub()
  diagnostics.add(diagnostic => reported.push(diagnostic))

  const handle = createMfeRuntime({
    registryEntries: [],
    loader: createInProcessLoader(new Map()),
    shellState: { user: null, groups: [], theme: 'dark' },
    telemetryProvider: createNoopTelemetryProvider(),
    diagnostics,
    adapters: [reactAdapter],
  })

  const current: Wired = { handle, storage: handle.runtime.storage, reported }
  wired = current
  return current
}

function setup(options?: MfeTestEnvironmentOptions): MfeTestEnvironment {
  environment = createMfeTestEnvironment(options)
  return environment
}

/** A mount as a React host's definition renders under, with its dispose. */
function mountOf(handle: MfeRuntimeHandle): { mount: MfeMount; dispose: () => Promise<void> } {
  const context = createMountContext({
    runtime: handle.runtime,
    definitionId: 'acme-orders',
    kind: 'app',
  })
  return { mount: withQueryClient(context.context), dispose: context.dispose }
}

/** The framework records this page wrote, by physical key. */
function stored(): Record<string, unknown> {
  const written: Record<string, unknown> = {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key !== null) written[key] = JSON.parse(localStorage.getItem(key) ?? 'null')
  }
  return written
}

/** Holds what a component last rendered, so the test can act on it outside the render. */
function captured<T>(): { readonly record: (value: T) => void; readonly current: () => T } {
  const box: { value?: T } = {}
  return {
    record: value => {
      box.value = value
    },
    current: () => {
      if (!('value' in box)) throw new Error('nothing has rendered yet')
      return box.value
    },
  }
}

/** One component used in both positions; nothing about it names a scope. */
function ThemeToggle({
  capture,
}: {
  readonly capture?: (set: StoredState<ShellTheme>['set']) => void
} = {}): ReactNode {
  const { value: theme, set, status } = useStoredState(themeKey)
  capture?.(set)

  return (
    <button
      type="button"
      data-status={status}
      onClick={() => void set(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme}
    </button>
  )
}

describe('useStoredState outside any mount', () => {
  it('reads and writes with no mount in scope, under the reserved host scope', async () => {
    const { handle } = wire()

    const view = render(
      <MfeProvider runtime={handle.runtime}>
        <ThemeToggle />
      </MfeProvider>,
    )

    expect(screen.getByRole('button')).toHaveTextContent('dark')
    expect(screen.getByRole('button')).toHaveAttribute('data-status', 'ready')

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveTextContent('light')
    expect(stored()['@host:theme']).toEqual({ v: 1, d: 'light' })
    view.unmount()
  })

  it('shows the default with an error status for an invalid stored record, without throwing', async () => {
    localStorage.setItem('@host:theme', JSON.stringify({ v: 1, d: 'sepia' }))
    const { handle } = wire()
    const error = captured<unknown>()

    function Probe(): ReactNode {
      const state = useStoredState(themeKey)
      error.record(state.error)
      return <output>{`${state.status}:${state.value}`}</output>
    }

    const view = render(
      <MfeProvider runtime={handle.runtime}>
        <Probe />
      </MfeProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('error:dark')
    expect(error.current()).toMatchObject({ code: 'storage/invalid-value' })

    // An explicit value repairs the record; an updater would have nothing valid to apply to.
    await act(() => handle.runtime.storage.forCaller({ owner: HOST_SCOPE }).set(themeKey, 'light'))
    expect(screen.getByRole('status')).toHaveTextContent('ready:light')
    view.unmount()
  })
})

/** The same shape as `ThemeToggle`, for a second record beside it. */
function DensityToggle(): ReactNode {
  const { value: density, set } = useStoredState(densityKey)

  return (
    <button
      type="button"
      onClick={() => void set(previous => (previous === 'compact' ? 'comfortable' : 'compact'))}
    >
      {density}
    </button>
  )
}

describe('a stored value', () => {
  it('outlives the signed-in identity, since it belongs to the browser', async () => {
    const { handle } = wire()

    const view = render(
      <MfeProvider runtime={handle.runtime}>
        <DensityToggle />
      </MfeProvider>,
    )

    await userEvent.click(screen.getByRole('button'))

    expect(stored()['@host:density']).toEqual({ v: 1, d: 'compact' })

    act(() => {
      handle.runtime.shellState.apply({ user: { id: 'grace', name: 'Grace' } })
    })

    expect(screen.getByRole('button')).toHaveTextContent('compact')
    expect(stored()['@host:density']).toEqual({ v: 1, d: 'compact' })

    view.unmount()
  })

  it('updates every component reading the key when one of them writes', async () => {
    const { handle } = wire()

    const view = render(
      <MfeProvider runtime={handle.runtime}>
        <DensityToggle />
        <DensityToggle />
      </MfeProvider>,
    )

    const [first, second] = screen.getAllByRole('button')
    await userEvent.click(first as HTMLElement)

    expect([first?.textContent, second?.textContent]).toEqual(['compact', 'compact'])
    view.unmount()
  })
})

describe('the scope follows where the component renders', () => {
  /** One hook rather than two costs this: the same component in two positions is two records. */
  it('binds the host scope outside a mount and the definition inside one', async () => {
    const { handle } = wire()

    const mounted = mountOf(handle)

    const view = render(
      <MfeProvider runtime={handle.runtime}>
        <ThemeToggle />
        <MfeMountProvider mount={mounted.mount}>
          <ThemeToggle />
        </MfeMountProvider>
      </MfeProvider>,
    )

    const [chrome, inApp] = screen.getAllByRole('button')
    expect([chrome?.textContent, inApp?.textContent]).toEqual(['dark', 'dark'])

    await userEvent.click(chrome as HTMLElement)

    // The host's write lands in `@host:theme` and leaves the App's record alone.
    expect(chrome).toHaveTextContent('light')
    expect(inApp).toHaveTextContent('dark')
    expect(Object.keys(stored())).toEqual(['@host:theme'])

    await userEvent.click(inApp as HTMLElement)

    expect(Object.keys(stored()).sort()).toEqual(['@host:theme', 'acme-orders:theme'])
    expect(HOST_SCOPE).toBe('@host')

    view.unmount()
    void mounted.dispose()
  })

  it('goes through one binding path, so both scopes get the same envelope', async () => {
    const { handle } = wire()

    const mounted = mountOf(handle)

    const view = render(
      <MfeProvider runtime={handle.runtime}>
        <ThemeToggle />
        <MfeMountProvider mount={mounted.mount}>
          <ThemeToggle />
        </MfeMountProvider>
      </MfeProvider>,
    )

    for (const button of screen.getAllByRole('button')) await userEvent.click(button)

    const written = stored()
    expect(written['@host:theme']).toEqual(written['acme-orders:theme'])

    view.unmount()
    void mounted.dispose()
  })
})

describe('the binding a render owns', () => {
  it('releases it on unmount, so the component stops holding the key open', () => {
    const { handle, storage } = wire()

    // A second holder of the same key, which makes the entry's lifetime observable.
    const held = storage.browser.bindHost({
      name: 'theme',
      schema: themeKey.schema,
      defaultValue: 'dark',
    })

    render(
      <MfeProvider runtime={handle.runtime}>
        <ThemeToggle />
      </MfeProvider>,
    ).unmount()

    // If the unmount released, `held` is now the last binding and dropping it drops the entry.
    held.release()

    // A surviving entry would reject this different default rather than rebinding on it.
    expect(() =>
      storage.browser
        .bindHost({
          name: 'theme',
          schema: themeKey.schema,
          defaultValue: 'light',
        })
        .release(),
    ).not.toThrow()
  })

  it('leaves nothing open after unmount, so the key can be declared afresh', () => {
    const { handle, storage } = wire()

    render(
      <MfeProvider runtime={handle.runtime}>
        <ThemeToggle />
      </MfeProvider>,
    ).unmount()

    // A surviving entry would reject a different schema object or default.
    expect(() =>
      storage.browser
        .bindHost({ name: 'theme', schema: z.enum(['light', 'dark']), defaultValue: 'light' })
        .release(),
    ).not.toThrow()
  })

  it('leaves nothing open after a StrictMode mount and unmount', () => {
    const { handle, storage } = wire()

    render(
      <StrictMode>
        <MfeProvider runtime={handle.runtime}>
          <ThemeToggle />
        </MfeProvider>
      </StrictMode>,
    ).unmount()

    expect(() =>
      storage.browser
        .bindHost({ name: 'theme', schema: z.enum(['light', 'dark']), defaultValue: 'light' })
        .release(),
    ).not.toThrow()
  })

  it('leaves nothing open after a render that threw', () => {
    const { handle, storage } = wire()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    function Broken(): ReactNode {
      useStoredState(themeKey)
      throw new Error('render failed after reading the key')
    }

    expect(() =>
      render(
        <MfeProvider runtime={handle.runtime}>
          <Broken />
        </MfeProvider>,
      ),
    ).toThrow(/render failed/)

    expect(() =>
      storage.browser
        .bindHost({ name: 'theme', schema: z.enum(['light', 'dark', 'sepia']) })
        .release(),
    ).not.toThrow()
  })

  it('keeps two components on one key in step under StrictMode', async () => {
    const { handle } = wire()

    const view = render(
      <StrictMode>
        <MfeProvider runtime={handle.runtime}>
          <ThemeToggle />
          <ThemeToggle />
        </MfeProvider>
      </StrictMode>,
    )

    const [first, second] = screen.getAllByRole('button')
    await userEvent.click(first as HTMLElement)

    expect([first?.textContent, second?.textContent]).toEqual(['light', 'light'])
    view.unmount()
  })

  it('keeps one binding, and one setter, across renders that change other state', async () => {
    const { handle } = wire()

    const setters: StoredState<ShellTheme>['set'][] = []

    function Panel(): ReactNode {
      const [count, setCount] = useState(0)
      return (
        <>
          <ThemeToggle
            capture={setter => {
              setters.push(setter)
            }}
          />
          <button type="button" onClick={() => setCount(count + 1)}>
            count:{count}
          </button>
        </>
      )
    }

    const view = render(
      <MfeProvider runtime={handle.runtime}>
        <Panel />
      </MfeProvider>,
    )

    // Counted on the browser store itself, so no counter has to ship in production.
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    await userEvent.click(screen.getByRole('button', { name: /count:/ }))

    expect(screen.getByRole('button', { name: /count:/ })).toHaveTextContent('count:1')
    // The binding is cached: a rerender must not re-read the browser store.
    expect(reads).not.toHaveBeenCalled()
    handle.runtime.storage.browser.bindHost({ name: 'probe', schema: themeSchema }).release()
    expect(reads).toHaveBeenCalled()
    expect(setters.length).toBeGreaterThan(1)
    expect(new Set(setters).size).toBe(1)

    view.unmount()
  })

  it('renders once on mount, since subscribing reads the same snapshot the render did', () => {
    const env = setup()
    const values: unknown[] = []
    const objectKey = storedKey(
      'mount-probe',
      z.object({ open: z.boolean() }).default({ open: true }),
    )

    function Probe(): ReactNode {
      const { value } = useStoredState(objectKey)
      values.push(value)
      return null
    }

    render(
      <env.wrapper>
        <Probe />
      </env.wrapper>,
    )

    expect(values).toHaveLength(1)
  })

  it('accepts a write from a child effect that runs before the parent subscribes', () => {
    const env = setup()

    function Child({ onMount }: { readonly onMount: () => void }): ReactNode {
      useEffect(onMount, [onMount])
      return null
    }

    function Parent(): ReactNode {
      const { value, set } = useStoredState(densityKey)
      const [onMount] = useState(() => () => void set('compact'))
      return (
        <>
          <output>{value}</output>
          <Child onMount={onMount} />
        </>
      )
    }

    render(
      <env.wrapper>
        <Parent />
      </env.wrapper>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('compact')
    expect(env.storage.peek(densityKey)).toBe('compact')
  })
})

describe('a key with a version', () => {
  it('migrates an older browser record on read and stores the next save at the new version', async () => {
    const legacy = storedKey('layout', z.enum(['grid', 'list']).default('grid'), {
      version: 2,
      migrate: (value, from) => (from === 1 && value === 'tiles' ? 'grid' : 'list'),
    })
    const env = setup({ definitionId: 'acme-orders' })
    env.storageAreas.local.setItem('acme-orders:layout', JSON.stringify({ v: 1, d: 'tiles' }))
    const set = captured<StoredState<'grid' | 'list'>['set']>()

    function Probe(): ReactNode {
      const state = useStoredState(legacy)
      set.record(state.set)
      return <output>{`${state.status}:${state.value}`}</output>
    }

    render(
      <env.wrapper>
        <Probe />
      </env.wrapper>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('ready:grid')

    await act(() => set.current()('list'))
    expect(JSON.parse(env.storageAreas.local.getItem('acme-orders:layout') ?? 'null')).toEqual({
      v: 2,
      d: 'list',
    })
  })

  it('migrates an older user row for the reader without saving it', async () => {
    const units = storedKey('units', z.enum(['metric', 'imperial']).default('metric'), {
      storage: 'user',
      version: 2,
      migrate: (value, from) => (from === 1 && value === 'us' ? 'imperial' : 'metric'),
    })
    const userStorage = createMemoryUserStorage({
      'acme-orders': { units: { v: 1, d: 'us', revision: 3 } },
    })
    const env = setup({ definitionId: 'acme-orders', userStorage })

    render(
      <env.wrapper>
        <StatusProbe storedKey={units} />
      </env.wrapper>,
    )

    expect(await screen.findByText('ready:imperial')).toBeInTheDocument()
    expect(userStorage.saves).toEqual([])
  })
})

// -------------------------------------------------------------------------------------------
// The user area: loaded once by the shell, saved one key at a time.

const unitsSchema = z.enum(['metric', 'imperial']).default('metric')
const unitsKey = storedKey('units', unitsSchema, { storage: 'user' })

function StatusProbe({ storedKey: key }: { readonly storedKey: typeof unitsKey }): ReactNode {
  const { value, status } = useStoredState(key)
  return <output>{`${status}:${value}`}</output>
}

interface PendingSave {
  readonly owner: string
  readonly key: string
  readonly value: StoredValue | null
  resolve(): void
  reject(error: unknown): void
}

/** A backend whose saves wait until the test settles them, one by one. */
function controllableAdapter(initial: UserStorageState = {}): UserStorageAdapter & {
  readonly pending: PendingSave[]
} {
  const pending: PendingSave[] = []
  let revision = 1
  return {
    pending,
    load: () => Promise.resolve(initial),
    save: (owner, key, value) =>
      new Promise<StoredRow | null>((resolve, reject) => {
        pending.push({
          owner,
          key,
          value,
          resolve: () => {
            revision += 1
            resolve(value === null ? null : { ...value, revision })
          },
          reject,
        })
      }),
  }
}

/** Renders the units picker and hands back the latest hook result. */
function renderUnits(env: MfeTestEnvironment): {
  readonly current: () => StoredState<'metric' | 'imperial'>
} {
  const latest = captured<StoredState<'metric' | 'imperial'>>()

  function Picker(): ReactNode {
    const state = useStoredState(unitsKey)
    latest.record(state)
    return <output>{`${state.status}:${state.value}`}</output>
  }

  render(
    <env.wrapper>
      <Picker />
    </env.wrapper>,
  )
  return { current: latest.current }
}

describe('useStoredState on a user key', () => {
  it('goes from loading, showing the default, to ready with the stored value', async () => {
    const env = setup({ storage: [[unitsKey, 'imperial']] })

    renderUnits(env)

    expect(screen.getByRole('status')).toHaveTextContent('loading:metric')
    expect(await screen.findByText('ready:imperial')).toBeInTheDocument()
  })

  it('keeps the default while the load is pending, and refuses writes until it settles', async () => {
    const env = setup({
      userStorage: {
        load: () => new Promise<UserStorageState>(() => {}),
        save: () => Promise.reject(new Error('unreachable')),
      },
    })

    const picker = renderUnits(env)

    expect(screen.getByRole('status')).toHaveTextContent('loading:metric')
    await expect(picker.current().set('imperial')).rejects.toMatchObject({
      code: 'storage/not-ready',
    })
    expect(screen.getByRole('status')).toHaveTextContent('loading:metric')
  })

  it('shows the new value as saving until the backend stores it, then resolves', async () => {
    const adapter = controllableAdapter()
    const env = setup({ userStorage: adapter })
    const picker = renderUnits(env)
    await screen.findByText('ready:metric')

    let settled = false
    let saving: Promise<void> = Promise.resolve()
    act(() => {
      saving = picker.current().set('imperial')
      void saving.then(() => {
        settled = true
      })
    })

    expect(screen.getByRole('status')).toHaveTextContent('saving:imperial')
    expect(adapter.pending).toHaveLength(1)
    expect(adapter.pending[0]).toMatchObject({
      owner: 'test-definition',
      key: 'units',
      value: { v: 1, d: 'imperial' },
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    await act(async () => {
      adapter.pending[0]?.resolve()
      await saving
    })

    expect(settled).toBe(true)
    expect(screen.getByRole('status')).toHaveTextContent('ready:imperial')
  })

  it('rolls back a failed save with an error status, and sends it again on retry', async () => {
    const adapter = controllableAdapter()
    const env = setup({ userStorage: adapter })
    const picker = renderUnits(env)
    await screen.findByText('ready:metric')

    let saving: Promise<void> = Promise.resolve()
    act(() => {
      saving = picker.current().set('imperial')
    })
    expect(screen.getByRole('status')).toHaveTextContent('saving:imperial')

    await act(async () => {
      adapter.pending[0]?.reject(new Error('backend down'))
      await expect(saving).rejects.toMatchObject({ code: 'storage/persistence-failed' })
    })

    expect(screen.getByRole('status')).toHaveTextContent('error:metric')
    expect(picker.current().error).toMatchObject({ code: 'storage/persistence-failed' })
    expect(env.diagnostics.some(d => d.error.code === 'storage/persistence-failed')).toBe(true)

    let retrying: Promise<void> = Promise.resolve()
    act(() => {
      retrying = picker.current().retry()
    })
    expect(screen.getByRole('status')).toHaveTextContent('saving:imperial')
    expect(adapter.pending).toHaveLength(2)
    expect(adapter.pending[1]?.value).toEqual({ v: 1, d: 'imperial' })

    await act(async () => {
      adapter.pending[1]?.resolve()
      await retrying
    })
    expect(screen.getByRole('status')).toHaveTextContent('ready:imperial')
    expect(picker.current().error).toBeUndefined()
  })

  it('removes the stored value on reset, so the key reads its default again', async () => {
    const env = setup({ storage: [[unitsKey, 'imperial']] })
    const picker = renderUnits(env)
    await screen.findByText('ready:imperial')

    await act(() => picker.current().reset())

    expect(screen.getByRole('status')).toHaveTextContent('ready:metric')
    expect(env.userStorage?.saves).toEqual([
      { owner: 'test-definition', key: 'units', value: null },
    ])
  })

  it('updates when the shell replaces the state from another device', async () => {
    const env = setup({ storage: [[unitsKey, 'metric']] })
    renderUnits(env)
    await screen.findByText('ready:metric')

    act(() => {
      env.userStorage?.write('test-definition', 'units', { v: 1, d: 'imperial' })
    })

    expect(screen.getByRole('status')).toHaveTextContent('ready:imperial')
  })

  it('reads the value of another component on the same key once it saves', async () => {
    const env = setup()
    const set = captured<StoredState<'metric' | 'imperial'>['set']>()

    function Writer(): ReactNode {
      set.record(useStoredState(unitsKey).set)
      return null
    }

    render(
      <env.wrapper>
        <Writer />
        <StatusProbe storedKey={unitsKey} />
      </env.wrapper>,
    )
    await screen.findByText('ready:metric')

    await act(() => set.current()('imperial'))

    expect(screen.getByRole('status')).toHaveTextContent('ready:imperial')
  })
})

describe('a read-only key from another app', () => {
  const labUnits = storedKey.from('lab', 'units', unitsSchema, { storage: 'user' })

  it('has no setter in its type and reads the owner’s value', async () => {
    const env = setup({ storage: [[labUnits, 'imperial']] })
    const state = captured<object>()

    function Reader(): ReactNode {
      const result = useStoredState(labUnits)
      // @ts-expect-error: a key declared with storedKey.from has no setter.
      void result.set
      // @ts-expect-error: nor does it have a reset
      void result.reset
      state.record(result)
      return <output>{`${result.status}:${result.value}`}</output>
    }

    render(
      <env.wrapper>
        <Reader />
      </env.wrapper>,
    )

    expect(await screen.findByText('ready:imperial')).toBeInTheDocument()
    expect(state.current()).not.toHaveProperty('set')
    expect(env.userStorage?.snapshot()).toEqual({
      lab: { units: { v: 1, d: 'imperial', revision: 1 } },
    })
  })

  it('refuses a write at runtime, so the owner stays the only writer', async () => {
    const env = setup({ storage: [[labUnits, 'imperial']] })
    await env.runtime.storage.whenLoaded()

    await expect(
      // @ts-expect-error: the imperative setter takes only keys this app declared.
      env.storage.set(labUnits, 'metric'),
    ).rejects.toMatchObject({ code: 'storage/unauthorized-owner' })
    expect(env.storage.peek(labUnits)).toBe('imperial')
  })

  it('reads its own default with an error status when the owner’s value does not match its schema', async () => {
    const strict = storedKey.from('lab', 'units', z.enum(['si']).default('si'), { storage: 'user' })
    const env = setup({
      userStorage: createMemoryUserStorage({
        lab: { units: { v: 1, d: 'imperial', revision: 1 } },
      }),
    })

    function Reader(): ReactNode {
      const { value, status, error } = useStoredState(strict)
      return <output>{`${status}:${value}:${error?.code ?? 'none'}`}</output>
    }

    render(
      <env.wrapper>
        <Reader />
      </env.wrapper>,
    )

    expect(await screen.findByText('error:si:storage/invalid-value')).toBeInTheDocument()
  })
})

describe('select', () => {
  const filtersKey = storedKey(
    'filters',
    z
      .object({ well: z.string().nullable(), status: z.enum(['open', 'closed']) })
      .default({ well: null, status: 'open' }),
  )

  it('re-renders only when the selected part changes, and set still takes the whole value', () => {
    const env = setup()
    const renders = captured<number>()
    const set =
      captured<
        StoredState<{ well: string | null; status: 'open' | 'closed' }, string | null>['set']
      >()
    renders.record(0)

    function Well(): ReactNode {
      renders.record(renders.current() + 1)
      // An inline selector, as an author writes it.
      const state = useStoredState(filtersKey, { select: filters => filters.well })
      set.record(state.set)
      return <output>{state.value ?? 'none'}</output>
    }

    render(
      <env.wrapper>
        <Well />
      </env.wrapper>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('none')
    const baseline = renders.current()

    act(() => void set.current()(previous => ({ ...previous, status: 'closed' })))
    expect(renders.current()).toBe(baseline)
    expect(env.storage.peek(filtersKey)).toEqual({ well: null, status: 'closed' })

    act(() => void set.current()(previous => ({ ...previous, well: 'A-7' })))
    expect(renders.current()).toBe(baseline + 1)
    expect(screen.getByRole('status')).toHaveTextContent('A-7')
  })

  it('applies a changed selector at once, without waiting for the value to change', () => {
    const env = setup()

    function Field({ field }: { readonly field: 'well' | 'status' }): ReactNode {
      const state = useStoredState(filtersKey, { select: filters => filters[field] })
      return <output>{state.value ?? 'none'}</output>
    }

    const { rerender } = render(
      <env.wrapper>
        <Field field="well" />
      </env.wrapper>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('none')

    rerender(
      <env.wrapper>
        <Field field="status" />
      </env.wrapper>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('open')
  })
})

describe('perInstance keys in the user area', () => {
  const tileZoom = storedKey('zoom', z.number().default(1), { storage: 'user', perInstance: true })

  it('reads the row of the mount’s own instance', async () => {
    const env = setup({ instanceId: 'tile-7', storage: [[tileZoom, 3]] })

    function Zoom(): ReactNode {
      const { value, status } = useStoredState(tileZoom)
      return <output>{`${status}:${value}`}</output>
    }

    render(
      <env.wrapper>
        <Zoom />
      </env.wrapper>,
    )

    expect(await screen.findByText('ready:3')).toBeInTheDocument()
    expect(env.userStorage?.snapshot()).toEqual({
      'test-definition': { 'zoom@tile-7': { v: 1, d: 3, revision: 1 } },
    })
  })
})

describe('a runtime given an existing hub', () => {
  it('reports the store it built into the sink the shell already wired', () => {
    const { handle, reported } = wire()

    expect(() =>
      handle.runtime.storage.browser.bind('acme-orders', { name: '', schema: themeSchema }),
    ).toThrow()
    expect(reported.some(diagnostic => diagnostic.error.code === 'storage/failure')).toBe(true)
  })

  it('leaves the hub alive when the runtime is disposed, because it did not make it', () => {
    const { handle, reported } = wire()
    const hub = handle.runtime.diagnostics

    handle.dispose()

    // Disposal removes only what this call added, so the shell's own sink is still there.
    const before = reported.length
    hub.report(
      createMfeError({
        code: 'config/invalid',
        id: HOST_SCOPE,
        operation: 'report after disposal',
      }),
    )
    expect(reported.length).toBeGreaterThan(before)
  })
})
