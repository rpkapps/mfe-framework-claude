/**
 * `useStoredState`, in both the positions it is legal in.
 *
 * The hook has one behaviour with one rule attached to it: the record's scope
 * is decided by where the component renders. Inside a mount it is that
 * definition's; outside one — a component the shell renders above every mount —
 * it is the host page's reserved `@host` scope. There is no second hook and no
 * flag, so the tests here are mostly about proving that the one binding path
 * really is one path: the same component, the same declaration, two scopes.
 *
 * The store under all of it is the runtime's own: a shell no longer builds one
 * before the runtime, so these render against the browser store the way a page
 * does, and read the records back out of it.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { createMfeError, DiagnosticsHub, HOST_SCOPE, type Diagnostic } from '@company/mfe-core'
import { createNoopTelemetryProvider, type MfeStorageStore } from '@company/mfe-host'
import { createInProcessLoader } from '@company/mfe-host/testing'
import { z } from 'zod'

import { createMfeRuntime, createMount, type MfeRuntimeHandle } from '../create-runtime.ts'
import { MfeMountProvider } from '../mount-context.tsx'
import { MfeProvider } from '../runtime-context.tsx'
import { useStoredState, type StoredStateSetter } from './use-stored-state.ts'

type ShellTheme = 'light' | 'dark'

const themeSchema = z.enum(['light', 'dark'])

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
    sessionGeneration: 'gen-1',
  })

  wired = { handle, storage: handle.runtime.storage, reported }
  return wired
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

/**
 * One component, used in both positions. Nothing about it names a scope, which
 * is the property under test: the same source reads the host's record when the
 * chrome renders it and the definition's when an App does.
 */
function ThemeToggle({
  capture,
}: {
  readonly capture?: (setter: StoredStateSetter<ShellTheme>) => void
} = {}): ReactNode {
  // Explicit, only so the captured setter below has a name to be compared by.
  const [theme, setTheme] = useStoredState<ShellTheme>('theme', themeSchema, {
    defaultValue: 'dark',
    retention: 'browser',
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
    expect(stored()['@host:theme']).toEqual({ v: 1, r: 'browser', d: 'light' })
    view.unmount()
  })

  it('reports an invalid stored record through the hub the shell supplied', () => {
    localStorage.setItem('@host:theme', JSON.stringify({ v: 1, r: 'browser', d: 'sepia' }))
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

describe('the scope follows where the component renders', () => {
  /**
   * The accepted cost of one hook rather than two: the same component in the
   * two positions is two records, not one. It is the cost `useCommand` and
   * `useBreadcrumbs` already carry, and the alternative — a second hook — is a
   * decision every caller has to restate and can restate wrongly. A component
   * that must read one record wherever it renders is a host component, so the
   * host renders it.
   */
  it('binds the host scope outside a mount and the definition inside one', async () => {
    const { handle } = wire()

    const mounted = createMount({
      runtime: handle.runtime,
      definitionId: 'acme-orders',
      kind: 'app',
    })

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

    // The host's write lands in `@host:theme` and leaves the App's record
    // alone; the App's toggle still shows its own value.
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

    const mounted = createMount({
      runtime: handle.runtime,
      definitionId: 'acme-orders',
      kind: 'app',
    })

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

    // A second holder of the same key, declared exactly as the component
    // declares it. It makes the entry's lifetime observable: the store keeps an
    // entry alive while anything still holds a binding to it.
    const held = storage.bindHost({
      name: 'theme',
      schema: themeSchema,
      retention: 'browser',
      defaultValue: 'dark',
    })

    render(
      <MfeProvider runtime={handle.runtime}>
        <ThemeToggle />
      </MfeProvider>,
    ).unmount()

    // If the unmount released, `held` is now the last binding and dropping it
    // drops the entry. If it did not, the component's binding is still counted
    // and the entry survives.
    held.release()

    // The store makes the active declarations of one key agree, so a surviving
    // entry rejects a different default rather than rebinding on it. Binding
    // cleanly is the proof that nothing is holding the key any more.
    expect(() =>
      storage
        .bindHost({
          name: 'theme',
          schema: themeSchema,
          retention: 'browser',
          defaultValue: 'light',
        })
        .release(),
    ).not.toThrow()
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

    // Counted on the browser store itself, so no counter has to ship in
    // production for the caching contract to be observable.
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    await userEvent.click(screen.getByRole('button', { name: /count:/ }))

    expect(screen.getByRole('button', { name: /count:/ })).toHaveTextContent('count:1')
    // The binding is cached: a rerender must not re-read the browser store.
    expect(reads).not.toHaveBeenCalled()
    // And the spy really does see the store's reads, or the line above would
    // have passed for the wrong reason.
    handle.runtime.storage.bindHost({ name: 'probe', schema: themeSchema }).release()
    expect(reads).toHaveBeenCalled()
    // And the setter survives it, so a consumer may put it in a dependency list.
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

    // Disposal removes only what this call added, so the shell's own sink is
    // still there for whatever the shell reports next.
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
