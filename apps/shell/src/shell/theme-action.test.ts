// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MfeProvider } from '@company/mfe-react'
import { createHostUserContextBindings } from '@company/mfe-react/user-context'
import { createMfeRuntime, type HostUserContextOptions } from '@company/mfe-react/host'
import {
  createMemoryNavigationBridge,
  createRecordingTelemetryProvider,
} from '@company/mfe-react/testing'
import { z } from 'zod'
type UserContextAdapter = HostUserContextOptions['adapter']
type StateRecord = Awaited<ReturnType<UserContextAdapter['write']>>
import { toast } from 'sonner'
import { useUserContext } from '#mfe/user-context'
import { ThemeAction, UserPreferences } from './theme-action.tsx'

vi.mock('@company/mfe-devtools', () => ({ devtools: { open: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('#mfe/user-context', () => ({
  useUserContext: (selector: (value: Values) => unknown) => bindings.useUserContext(selector),
}))

const schema = z.strictObject({
  preferences: z
    .strictObject({ theme: z.enum(['light', 'dark', 'system']) })
    .default({ theme: 'light' }),
})
type Values = z.output<typeof schema>
const bindings = createHostUserContextBindings<Values>()
const disposals: (() => void)[] = []
const roots: Root[] = []
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function setup() {
  const hydration = deferred<readonly StateRecord[]>()
  const commit = deferred<StateRecord>()
  const write = vi.fn<UserContextAdapter['write']>(() => commit.promise)
  const hydrate = vi.fn<UserContextAdapter['hydrate']>(() => hydration.promise)
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
    userContext: { schema, adapter: { hydrate, write } },
    theme: context => context.preferences.theme,
  })
  disposals.push(handle.dispose)
  const container = document.createElement('div')
  document.body.append(container)
  const component = createRoot(container)
  roots.push(component)
  await act(async () => {
    component.render(
      createElement(MfeProvider, { runtime: handle.runtime, children: createElement(ThemeAction) }),
    )
  })
  const entries = () => handle.runtime.actions.getSnapshot().filter(entry => entry.name === 'theme')
  const execute = () => handle.runtime.actions.execute('@host:theme', { caller: 'ui' })
  return { ...handle, component, hydration, commit, hydrate, write, entries, execute }
}

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  for (const dispose of disposals.splice(0)) dispose()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('persistent theme shortcut component', () => {
  it('reserves the shortcut during hydration and persists before publishing the changed theme', async () => {
    const test = await setup()
    expect(test.entries()).toHaveLength(1)
    expect(test.entries()[0]?.shortcut).toBe('mod+j')
    expect((await test.execute()).status).toBe('denied')
    expect(test.write).not.toHaveBeenCalled()
    await act(async () => {
      test.hydration.resolve([{ id: 'shell', revision: 0 }])
    })
    await vi.waitFor(() => expect(test.entries()[0]?.decision.allowed).toBe(true))
    let action!: ReturnType<typeof test.execute>
    act(() => {
      action = test.execute()
    })
    await vi.waitFor(() => expect(test.write).toHaveBeenCalledTimes(1))
    expect(test.runtime.shellState.getTheme()).toBe('light')
    // An unrelated shell render must update the closure without cancelling this accepted action.
    act(() => {
      test.component.render(
        createElement(MfeProvider, {
          runtime: test.runtime,
          children: createElement(ThemeAction),
        }),
      )
    })
    await act(async () => {
      test.commit.resolve({ id: 'shell', revision: 1, value: { preferences: { theme: 'dark' } } })
    })
    expect((await action).status).toBe('executed')
    expect(test.runtime.shellState.getTheme()).toBe('dark')
    expect(test.entries()).toHaveLength(1)
    expect(test.entries()[0]?.label).toBe('Switch to light theme')
  })

  it('keeps the unavailable shortcut registered when preferences fail to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const test = await setup()
    await act(async () => {
      test.hydration.reject(new Error('API unavailable'))
    })
    await vi.waitFor(() => expect(test.entries()).toHaveLength(1))
    expect(test.entries()[0]?.shortcut).toBe('mod+j')
    expect((await test.execute()).status).toBe('denied')
    expect(test.write).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('loads the preferences again when a preferences boundary mounts after a failed load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const test = await setup()
    await act(async () => {
      test.hydration.reject(new Error('API unavailable'))
    })
    expect(test.hydrate).toHaveBeenCalledTimes(1)
    test.hydrate.mockResolvedValue([
      { id: 'shell', revision: 1, value: { preferences: { theme: 'dark' } } },
    ])
    function SavedTheme() {
      const [theme] = useUserContext(context => context.preferences.theme)
      return theme
    }
    const container = document.createElement('div')
    document.body.append(container)
    const settings = createRoot(container)
    roots.push(settings)
    await act(async () => {
      settings.render(
        createElement(MfeProvider, {
          runtime: test.runtime,
          children: createElement(UserPreferences, {
            pending: 'Loading',
            failed: 'Unavailable',
            children: createElement(SavedTheme),
          }),
        }),
      )
    })
    await vi.waitFor(() => expect(container.textContent).toBe('dark'))
    expect(test.hydrate).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(test.entries()[0]?.decision.allowed).toBe(true))
    expect(test.runtime.shellState.getTheme()).toBe('dark')
    error.mockRestore()
  })

  it('reports a persistence failure and keeps the previously confirmed theme', async () => {
    const test = await setup()
    await act(async () => {
      test.hydration.resolve([{ id: 'shell', revision: 0 }])
    })
    await vi.waitFor(() => expect(test.entries()[0]?.decision.allowed).toBe(true))
    let action!: ReturnType<typeof test.execute>
    act(() => {
      action = test.execute()
    })
    await vi.waitFor(() => expect(test.write).toHaveBeenCalledTimes(1))
    await act(async () => {
      test.commit.reject(new Error('Save unavailable'))
    })
    expect((await action).status).toBe('failed')
    expect(test.runtime.shellState.getTheme()).toBe('light')
    expect(toast.error).toHaveBeenCalledWith('Your theme was not saved. Please try again.')
  })

  it('rejects an in-flight old-user action and ignores its late persistence result', async () => {
    const test = await setup()
    await act(async () => {
      test.hydration.resolve([{ id: 'shell', revision: 0 }])
    })
    await vi.waitFor(() => expect(test.entries()[0]?.decision.allowed).toBe(true))
    let action!: ReturnType<typeof test.execute>
    act(() => {
      action = test.execute()
    })
    await vi.waitFor(() => expect(test.write).toHaveBeenCalledTimes(1))
    const nextHydration = deferred<readonly StateRecord[]>()
    test.hydrate.mockImplementation(() => nextHydration.promise)
    await act(async () => {
      test.runtime.shellState.apply({ user: { id: 'second', name: 'Second' } })
    })
    expect(test.entries()).toHaveLength(1)
    expect((await action).status).not.toBe('executed')
    expect(toast.error).not.toHaveBeenCalled()
    expect((await test.execute()).status).toBe('denied')
    await act(async () => {
      test.commit.resolve({ id: 'shell', revision: 1, value: { preferences: { theme: 'dark' } } })
      nextHydration.resolve([{ id: 'shell', revision: 0 }])
    })
    await vi.waitFor(() => expect(test.entries()[0]?.decision.allowed).toBe(true))
    expect(test.runtime.shellState.getTheme()).toBe('light')
    expect(test.write).toHaveBeenCalledTimes(1)
  })
})
