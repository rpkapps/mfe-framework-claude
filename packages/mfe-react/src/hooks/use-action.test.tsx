/**
 * Registering an action from the host's own chrome, which used to be impossible: the registry is
 * keyed by a mount token and the host has none (§26).
 */

import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { allow, deny, HOST_SCOPE, type ActionRegistration } from '@company/mfe-core'
import type { ActionExecutionResult, ActionRun } from '@company/mfe-runtime'
import { z } from 'zod'

import { MfeProvider } from '../runtime-context.tsx'
import { createMfeTestEnvironment, type MfeTestEnvironment } from '../testing/index.tsx'
import { useAction } from './use-action.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  vi.restoreAllMocks()
  const current = environment
  environment = null
  await current?.dispose()
})

function Chrome({ registration }: { readonly registration: ActionRegistration }): ReactNode {
  useAction(registration)
  return null
}

function hostOnly(created: MfeTestEnvironment, children: ReactNode): ReactNode {
  return <MfeProvider runtime={created.runtime}>{children}</MfeProvider>
}

describe('useAction outside a mount', () => {
  it('registers in the reserved host scope', () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment

    render(
      hostOnly(
        created,
        <Chrome registration={{ name: 'settings', label: 'Open settings', execute: () => {} }} />,
      ),
    )

    expect(created.runtime.actions.getSnapshot()).toMatchObject([
      { id: '@host:settings', definitionId: HOST_SCOPE, label: 'Open settings' },
    ])
  })

  it('runs the host action through the same execute the palette calls', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment
    const execute = vi.fn()

    render(
      hostOnly(created, <Chrome registration={{ name: 'settings', label: 'Settings', execute }} />),
    )

    await expect(
      created.runtime.actions.execute('@host:settings', { caller: 'palette' }),
    ).resolves.toEqual({
      status: 'executed',
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  /** A denied action is shown with its owner's reason rather than hidden, whoever owns it. */
  it('publishes the host’s own denial, and refuses to run', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment
    const execute = vi.fn()

    render(
      hostOnly(
        created,
        <Chrome
          registration={{
            name: 'clear-dashboard',
            label: 'Clear the dashboard canvas',
            canExecute: () => deny('The dashboard canvas is already empty.'),
            execute,
          }}
        />,
      ),
    )

    expect(created.runtime.actions.getSnapshot()[0]?.decision).toEqual({
      allowed: false,
      reason: 'The dashboard canvas is already empty.',
    })
    await expect(
      created.runtime.actions.execute('@host:clear-dashboard', { caller: 'palette' }),
    ).resolves.toMatchObject({
      status: 'denied',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('republishes the decision when the state it reads changes', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment

    function Canvas(): ReactNode {
      const [tiles, setTiles] = useState(0)
      useAction({
        name: 'clear-dashboard',
        label: 'Clear the dashboard canvas',
        canExecute: () => (tiles === 0 ? deny('Nothing on the canvas.') : allow()),
        execute: () => {},
      })

      return (
        <button
          type="button"
          onClick={() => {
            setTiles(1)
          }}
        >
          add
        </button>
      )
    }

    const view = render(hostOnly(created, <Canvas />))
    expect(created.runtime.actions.getSnapshot()[0]?.decision.allowed).toBe(false)

    view.getByRole('button').click()

    // Published from the effect that runs after every commit, so the palette's snapshot follows.
    await waitFor(() => {
      expect(created.runtime.actions.getSnapshot()[0]?.decision.allowed).toBe(true)
    })
  })

  it('removes the host action when the chrome that registered it unmounts', () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment

    const view = render(
      hostOnly(
        created,
        <Chrome registration={{ name: 'help', label: 'Help', execute: () => {} }} />,
      ),
    )
    expect(created.runtime.actions.size).toBe(1)

    view.unmount()

    expect(created.runtime.actions.size).toBe(0)
  })

  /** A mount keeps registering exactly as it did; the scope is what differs. */
  it('still registers under the definition when there is a mount', () => {
    environment = createMfeTestEnvironment({ definitionId: 'reports' })
    const created = environment
    const Mounted = created.wrapper

    render(
      <Mounted>
        <Chrome registration={{ name: 'refresh', label: 'Refresh', execute: () => {} }} />
      </Mounted>,
    )

    expect(created.runtime.actions.getSnapshot()).toMatchObject([
      { id: 'reports:refresh', definitionId: 'reports' },
    ])
  })
})

describe('useAction with a shortcut', () => {
  function press(init: KeyboardEventInit & { key: string }, created: MfeTestEnvironment) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    return created.runtime.actions.handleKeyDown(event)
  }

  it('passes the shortcut through, and the host’s key press runs the App’s action', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    environment = createMfeTestEnvironment({
      definitionId: 'reports',
      basePath: '/reports',
      initialEntries: ['/reports'],
    })
    const created = environment
    const Mounted = created.wrapper
    const execute = vi.fn()

    render(
      <Mounted>
        <Chrome registration={{ name: 'export', label: 'Export', shortcut: 'Mod+E', execute }} />
      </Mounted>,
    )

    expect(created.runtime.actions.getSnapshot()).toMatchObject([
      { id: 'reports:export', shortcut: 'mod+e' },
    ])
    expect(press({ key: 'e', ctrlKey: true }, created).status).toBe('matched')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('follows a re-render that changes the shortcut', () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment

    const view = render(
      hostOnly(
        created,
        <Chrome registration={{ name: 'help', label: 'Help', shortcut: '?', execute: () => {} }} />,
      ),
    )
    view.rerender(
      hostOnly(
        created,
        <Chrome
          registration={{ name: 'help', label: 'Help', shortcut: 'f1', execute: () => {} }}
        />,
      ),
    )

    expect(created.runtime.actions.getSnapshot()[0]?.shortcut).toBe('f1')
  })

  it('keeps a Widget’s action but not its shortcut', () => {
    environment = createMfeTestEnvironment({ definitionId: 'orders', kind: 'widget' })
    const created = environment
    const Mounted = created.wrapper

    render(
      <Mounted>
        <Chrome
          registration={{ name: 'export', label: 'Export', shortcut: 'mod+e', execute: () => {} }}
        />
      </Mounted>,
    )

    expect(created.runtime.actions.getSnapshot()[0]).not.toHaveProperty('shortcut')
    expect(created.diagnostics.map(record => record.error.message).join('\n')).toContain(
      'a shortcut from a Widget',
    )
  })
})

describe('the run useAction returns', () => {
  const refundInput = z.object({ orderId: z.string(), amount: z.number().positive() })

  it('runs the action as the App’s own UI, through the same validation', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'orders' })
    const created = environment
    const Mounted = created.wrapper
    const execute = vi.fn(({ amount }: { readonly amount: number }) => ({ refunded: amount }))
    const runs: ActionRun<typeof refundInput, { refunded: number }>[] = []

    function Refund(): ReactNode {
      runs.push(
        useAction({
          name: 'refund',
          label: 'Refund an order',
          inputSchema: refundInput,
          execute,
        }),
      )
      return null
    }
    render(
      <Mounted>
        <Refund />
      </Mounted>,
    )

    const run = runs.at(-1)
    const executed: ActionExecutionResult<{ refunded: number }> | undefined = await run?.({
      orderId: 'A-1',
      amount: 5,
    })
    expect(executed).toEqual({ status: 'executed', value: { refunded: 5 } })

    const invalid = await run?.({ orderId: 'A-1', amount: -5 })
    expect(invalid?.status).toBe('invalid')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('keeps its identity across renders, so it can be a dependency', () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment
    const runs: unknown[] = []

    function Chrome2(): ReactNode {
      runs.push(useAction({ name: 'help', label: 'Help', execute: () => {} }))
      return null
    }
    const view = render(hostOnly(created, <Chrome2 />))
    view.rerender(hostOnly(created, <Chrome2 />))

    expect(runs).toHaveLength(2)
    expect(runs[0]).toBe(runs[1])
  })

  it('calls as the App’s own UI, so a denial reaches the user', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment
    const execute = vi.spyOn(created.runtime.actions, 'execute')
    const runs: ActionRun[] = []

    function Clear(): ReactNode {
      runs.push(
        useAction({
          name: 'clear',
          label: 'Clear',
          canExecute: () => deny('Nothing to clear.'),
          execute: () => {},
        }),
      )
      return null
    }
    render(hostOnly(created, <Clear />))

    await expect(runs.at(-1)?.()).resolves.toEqual({
      status: 'denied',
      reason: 'Nothing to clear.',
    })
    expect(execute).toHaveBeenCalledWith('@host:clear', { caller: 'ui', input: undefined })
  })

  it('resolves unavailable once the component that registered it is gone', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment
    const runs: ActionRun[] = []

    function Help(): ReactNode {
      runs.push(useAction({ name: 'help', label: 'Help', execute: () => {} }))
      return null
    }
    const view = render(hostOnly(created, <Help />))
    view.unmount()

    await expect(runs.at(-1)?.()).resolves.toMatchObject({ status: 'unavailable' })
  })
})
