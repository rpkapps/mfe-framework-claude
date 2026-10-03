// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HOST_SCOPE, MfeProvider } from '@company/mfe-react'
import { createMfeRuntime, type CreateMfeRuntimeOptions } from '@company/mfe-react/host'
import {
  createMemoryNavigationBridge,
  createRecordingTelemetryProvider,
} from '@company/mfe-react/testing'
import { toast } from 'sonner'

import { themeKey } from '../storage.ts'
import { ThemeAction } from './theme-action.tsx'

vi.mock('@company/mfe-devtools', () => ({ devtools: { open: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

type UserStorageAdapter = NonNullable<NonNullable<CreateMfeRuntimeOptions['storage']>['user']>
type UserStorageState = Awaited<ReturnType<UserStorageAdapter['load']>>
type StoredRow = NonNullable<Awaited<ReturnType<UserStorageAdapter['save']>>>

const disposals: (() => void)[] = []
const roots: Root[] = []
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function setup() {
  let loading = deferred<UserStorageState>()
  const commit = deferred<StoredRow>()
  const load = vi.fn<UserStorageAdapter['load']>(() => loading.promise)
  // A real adapter's request ends with its signal, as fetch does.
  const save = vi.fn<UserStorageAdapter['save']>(
    (_owner, _key, _value, signal) =>
      new Promise((resolve, reject) => {
        commit.promise.then(resolve, reject)
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
      }),
  )
  const handle = createMfeRuntime({
    registryEntries: [],
    adapters: [],
    loader: {
      load: async () => {
        throw new Error('No definitions in this test')
      },
    },
    shellState: { user: { id: 'first', name: 'First' }, groups: [], theme: 'light' },
    telemetryProvider: createRecordingTelemetryProvider(),
    navigationBridge: createMemoryNavigationBridge(['/']),
    storage: { user: { load, save } },
    theme: themeKey,
  })
  disposals.push(handle.dispose)
  const container = document.createElement('div')
  document.body.append(container)
  const component = createRoot(container)
  roots.push(component)
  const render = () =>
    component.render(
      createElement(MfeProvider, { runtime: handle.runtime, children: createElement(ThemeAction) }),
    )
  await act(async () => {
    render()
  })
  const entries = () => handle.runtime.actions.getSnapshot().filter(entry => entry.name === 'theme')
  const execute = () => handle.runtime.actions.execute('@host:theme', { caller: 'ui' })
  const loaded = async (state: UserStorageState = {}) => {
    await act(async () => {
      loading.resolve(state)
      await handle.runtime.storage.whenLoaded()
    })
    await vi.waitFor(() => expect(entries()[0]?.decision.allowed).toBe(true))
  }
  return {
    ...handle,
    render,
    load,
    save,
    entries,
    execute,
    loaded,
    get loading() {
      return loading
    },
    nextLoad: () => {
      loading = deferred<UserStorageState>()
    },
    get commit() {
      return commit
    },
  }
}

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  for (const dispose of disposals.splice(0)) dispose()
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
})

describe('the theme shortcut', () => {
  it('is reserved while the preference loads, then saves the other theme', async () => {
    const test = await setup()
    expect(test.entries()).toHaveLength(1)
    expect(test.entries()[0]?.shortcut).toBe('mod+j')
    expect((await test.execute()).status).toBe('denied')
    expect(test.save).not.toHaveBeenCalled()

    await test.loaded()
    let action!: ReturnType<typeof test.execute>
    act(() => {
      action = test.execute()
    })
    await vi.waitFor(() => expect(test.save).toHaveBeenCalledTimes(1))
    expect(test.save.mock.calls[0]?.slice(0, 3)).toEqual([HOST_SCOPE, 'theme', { v: 1, d: 'dark' }])
    // Optimistic: the theme applies at once, and an unrelated render keeps the action running.
    expect(test.runtime.shellState.getTheme()).toBe('dark')
    act(() => {
      test.render()
    })
    await act(async () => {
      test.commit.resolve({ v: 1, d: 'dark', revision: 1 })
    })
    expect((await action).status).toBe('executed')
    expect(test.runtime.shellState.getTheme()).toBe('dark')
    expect(test.entries()).toHaveLength(1)
    expect(test.entries()[0]?.label).toBe('Switch to light theme')
  })

  it('stays registered and unavailable when the preference fails to load', async () => {
    const test = await setup()
    await act(async () => {
      test.loading.reject(new Error('API unavailable'))
      await test.runtime.storage.whenLoaded()
    })
    expect(test.entries()).toHaveLength(1)
    expect(test.entries()[0]?.shortcut).toBe('mod+j')
    expect((await test.execute()).status).toBe('denied')
    expect(test.save).not.toHaveBeenCalled()
  })

  it('reports a failed save and goes back to the confirmed theme', async () => {
    const test = await setup()
    await test.loaded({ [HOST_SCOPE]: { theme: { v: 1, d: 'light', revision: 1 } } })
    let action!: ReturnType<typeof test.execute>
    act(() => {
      action = test.execute()
    })
    await vi.waitFor(() => expect(test.save).toHaveBeenCalledTimes(1))
    await act(async () => {
      test.commit.reject(new Error('Save unavailable'))
    })
    expect((await action).status).toBe('failed')
    expect(test.runtime.shellState.getTheme()).toBe('light')
    expect(toast.error).toHaveBeenCalledWith('Your theme was not saved. Please try again.')
  })

  it('drops a save in flight when another user signs in, without reporting it', async () => {
    const test = await setup()
    await test.loaded({ [HOST_SCOPE]: { theme: { v: 1, d: 'light', revision: 1 } } })
    let action!: ReturnType<typeof test.execute>
    act(() => {
      action = test.execute()
    })
    await vi.waitFor(() => expect(test.save).toHaveBeenCalledTimes(1))
    test.nextLoad()
    await act(async () => {
      test.runtime.shellState.apply({ user: { id: 'second', name: 'Second' } })
    })
    expect((await action).status).not.toBe('executed')
    expect(toast.error).not.toHaveBeenCalled()
    expect(test.entries()).toHaveLength(1)
    expect((await test.execute()).status).toBe('denied')

    await test.loaded({ [HOST_SCOPE]: { theme: { v: 1, d: 'light', revision: 4 } } })
    expect(test.runtime.shellState.getTheme()).toBe('light')
    expect(test.save).toHaveBeenCalledTimes(1)
  })
})
