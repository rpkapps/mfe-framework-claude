/**
 * `useStoredState` in both the positions it is legal in: the record's scope is decided by where
 * the component renders, and there is no second hook and no flag (§24).
 */

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, useState, type ReactNode } from 'react'
import { createMfeError, HOST_SCOPE, type Diagnostic } from '@company/mfe-core'
import {
  createMfeRuntime,
  createMountContext,
  createNoopTelemetryProvider,
  DiagnosticsHub,
  type MfeRuntimeHandle,
  type MfeStorageStore,
} from '@company/mfe-runtime'
import { createInProcessLoader } from '@company/mfe-runtime/testing'
import { z } from 'zod'

import { MfeMountProvider } from '../mount-context.tsx'
import { reactAdapter } from '../registry/react-adapter.ts'
import { MfeProvider } from '../runtime-context.tsx'
import { withQueryClient, type MfeMount } from '../runtime.ts'
import { useStoredState, type StoredStateSetter } from './use-stored-state.ts'

type ShellTheme = 'light' | 'dark'

const themeSchema = z.enum(['light', 'dark'])
const densitySchema = z.enum(['comfortable', 'compact'])

interface Wired {
  readonly handle: MfeRuntimeHandle
  readonly storage: MfeStorageStore
  readonly reported: Diagnostic[]
}

let wired: Wired | null = null

afterEach(() => {
  const current = wired
  wired = null
  current?.handle.dispose()
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

  wired = { handle, storage: handle.runtime.storage, reported }
  return wired
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

/** One component used in both positions; nothing about it names a scope. */
function ThemeToggle({
  capture,
}: {
  readonly capture?: (setter: StoredStateSetter<ShellTheme>) => void
} = {}): ReactNode {
  // Explicit, only so the captured setter below has a name to be compared by.
  const [theme, setTheme] = useStoredState<ShellTheme>('theme', themeSchema, {
    defaultValue: 'dark',
  })
  capture?.(setTheme)

  return (
    <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
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

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveTextContent('light')
    expect(stored()['@host:theme']).toEqual({ v: 1, d: 'light' })
    view.unmount()
  })

  it('reports an invalid stored record through the hub the shell supplied', () => {
    localStorage.setItem('@host:theme', JSON.stringify({ v: 1, d: 'sepia' }))
    const { handle, reported } = wire()

    expect(() =>
      render(
        <MfeProvider runtime={handle.runtime}>
          <ThemeToggle />
        </MfeProvider>,
      ),
    ).toThrow()

    expect(reported.some(diagnostic => diagnostic.error.code === 'storage/failure')).toBe(true)
  })
})

/** The same shape as `ThemeToggle`, for a second record beside it. */
function DensityToggle(): ReactNode {
  const [density, setDensity] = useStoredState<'comfortable' | 'compact'>(
    'density',
    densitySchema,
    { defaultValue: 'comfortable' },
  )

  return (
    <button
      type="button"
      onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
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
    const held = storage.bindHost({
      name: 'theme',
      schema: themeSchema,
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
      storage
        .bindHost({
          name: 'theme',
          schema: themeSchema,
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
      storage
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
      storage
        .bindHost({ name: 'theme', schema: z.enum(['light', 'dark']), defaultValue: 'light' })
        .release(),
    ).not.toThrow()
  })

  it('leaves nothing open after a render that threw', () => {
    localStorage.setItem('@host:theme', JSON.stringify({ v: 1, d: 'sepia' }))
    const { handle, storage } = wire()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      render(
        <MfeProvider runtime={handle.runtime}>
          <ThemeToggle />
        </MfeProvider>,
      ),
    ).toThrow()

    expect(() =>
      storage.bindHost({ name: 'theme', schema: z.enum(['light', 'dark', 'sepia']) }).release(),
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

    const setters: StoredStateSetter<ShellTheme>[] = []

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
    handle.runtime.storage.bindHost({ name: 'probe', schema: themeSchema }).release()
    expect(reads).toHaveBeenCalled()
    expect(setters.length).toBeGreaterThan(1)
    expect(new Set(setters).size).toBe(1)

    view.unmount()
  })
})

describe('a runtime given an existing hub', () => {
  it('reports the store it built into the sink the shell already wired', () => {
    const { handle, reported } = wire()

    expect(() =>
      handle.runtime.storage.bind('acme-orders', { name: '', schema: themeSchema }),
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
