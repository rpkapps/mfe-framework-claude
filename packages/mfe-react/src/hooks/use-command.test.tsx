/**
 * Registering a command from the host's own chrome, which used to be impossible: the registry is
 * keyed by a mount token and the host has none (§26).
 */

import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { allow, deny, HOST_SCOPE, type CommandRegistration } from '@company/mfe-core'

import { MfeProvider } from '../runtime-context.tsx'
import { createMfeTestEnvironment, type MfeTestEnvironment } from '../testing/index.tsx'
import { useCommand } from './use-command.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

function Chrome({ registration }: { readonly registration: CommandRegistration }): ReactNode {
  useCommand(registration)
  return null
}

function hostOnly(created: MfeTestEnvironment, children: ReactNode): ReactNode {
  return <MfeProvider runtime={created.runtime}>{children}</MfeProvider>
}

describe('useCommand outside a mount', () => {
  it('registers in the reserved host scope', () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment

    render(
      hostOnly(
        created,
        <Chrome registration={{ name: 'settings', label: 'Open settings', execute: () => {} }} />,
      ),
    )

    expect(created.runtime.commands.getSnapshot()).toMatchObject([
      { id: '@host:settings', definitionId: HOST_SCOPE, label: 'Open settings' },
    ])
  })

  it('runs the host command through the same execute the palette calls', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment
    const execute = vi.fn()

    render(
      hostOnly(created, <Chrome registration={{ name: 'settings', label: 'Settings', execute }} />),
    )

    await expect(created.runtime.commands.execute('@host:settings')).resolves.toEqual({
      status: 'executed',
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  /** A denied command is shown with its owner's reason rather than hidden, whoever owns it. */
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

    expect(created.runtime.commands.getSnapshot()[0]?.decision).toEqual({
      allowed: false,
      reason: 'The dashboard canvas is already empty.',
    })
    await expect(created.runtime.commands.execute('@host:clear-dashboard')).resolves.toMatchObject({
      status: 'denied',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('republishes the decision when the state it reads changes', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment

    function Canvas(): ReactNode {
      const [tiles, setTiles] = useState(0)
      useCommand({
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
    expect(created.runtime.commands.getSnapshot()[0]?.decision.allowed).toBe(false)

    view.getByRole('button').click()

    // Published from the effect that runs after every commit, so the palette's snapshot follows.
    await waitFor(() => {
      expect(created.runtime.commands.getSnapshot()[0]?.decision.allowed).toBe(true)
    })
  })

  it('removes the host command when the chrome that registered it unmounts', () => {
    environment = createMfeTestEnvironment({ definitionId: 'shell' })
    const created = environment

    const view = render(
      hostOnly(
        created,
        <Chrome registration={{ name: 'help', label: 'Help', execute: () => {} }} />,
      ),
    )
    expect(created.runtime.commands.size).toBe(1)

    view.unmount()

    expect(created.runtime.commands.size).toBe(0)
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

    expect(created.runtime.commands.getSnapshot()).toMatchObject([
      { id: 'reports:refresh', definitionId: 'reports' },
    ])
  })
})
