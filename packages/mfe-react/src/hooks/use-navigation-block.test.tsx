/**
 * The mount's half of the navigation-blocking contract.
 *
 * What is being asserted is the division of labour: the host asks, the mount
 * answers in its own time, and nothing proceeds until it has. The cases that
 * matter are the ones a `window.confirm` cannot express — a mount that is not
 * dirty and is never asked, a mount that refuses, and a mount that disappears
 * while it is being asked and must not strand the host.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState, type ReactNode } from 'react'
import { createNavigationIntent, parseBoundaryLocation } from '@company/mfe-host'

import { createMfeTestEnvironment, type MfeTestEnvironment } from '../testing/index.tsx'
import { useNavigationBlock, type ShouldBlockNavigation } from './use-navigation-block.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

/** The navigation the host would perform: away from this App's boundary. */
function leaving(): ReturnType<typeof createNavigationIntent> {
  return createNavigationIntent(
    parseBoundaryLocation('/lab/unsaved'),
    parseBoundaryLocation('/operations'),
    '/lab',
  )
}

function Editor({ shouldBlock }: { readonly shouldBlock: ShouldBlockNavigation }): ReactNode {
  const block = useNavigationBlock(shouldBlock)

  return (
    <div>
      <span data-testid="pending">
        {block.pending === null ? 'idle' : block.pending.to.pathname}
      </span>
      <button type="button" onClick={block.proceed}>
        proceed
      </button>
      <button type="button" onClick={block.stay}>
        stay
      </button>
    </div>
  )
}

/** A mount that can unmount its editor, for the disposal case. */
function Host({ shouldBlock }: { readonly shouldBlock: ShouldBlockNavigation }): ReactNode {
  const [isMounted, setIsMounted] = useState(true)

  return (
    <div>
      {isMounted ? <Editor shouldBlock={shouldBlock} /> : <span>gone</span>}
      <button
        type="button"
        onClick={() => {
          setIsMounted(false)
        }}
      >
        unmount
      </button>
    </div>
  )
}

function mountEditor(shouldBlock: ShouldBlockNavigation): MfeTestEnvironment {
  const created = createMfeTestEnvironment({ definitionId: 'lab', basePath: '/lab' })
  const Wrapper = created.wrapper
  render(
    <Wrapper>
      <Host shouldBlock={shouldBlock} />
    </Wrapper>,
  )
  return created
}

describe('useNavigationBlock', () => {
  it('lets a navigation through when the mount has nothing to lose', async () => {
    environment = mountEditor(false)
    let committed = false

    const outcome = await act(
      async () =>
        await environment?.runtime.navigator.requestNavigation(leaving(), () => {
          committed = true
        }),
    )

    expect(outcome).toBe('proceeded')
    expect(committed).toBe(true)
    expect(screen.getByTestId('pending')).toHaveTextContent('idle')
  })

  it('holds the navigation until the mount answers, and commits when it proceeds', async () => {
    environment = mountEditor(true)
    let committed = false

    const negotiation = environment.runtime.navigator.requestNavigation(leaving(), () => {
      committed = true
    })

    // The mount is being asked, and nothing has happened yet: the host is
    // waiting on a decision this application has not made.
    await waitFor(() => {
      expect(screen.getByTestId('pending')).toHaveTextContent('/operations')
    })
    expect(committed).toBe(false)

    await act(async () => {
      screen.getByRole('button', { name: 'proceed' }).click()
      await negotiation
    })

    expect(await negotiation).toBe('proceeded')
    expect(committed).toBe(true)
    expect(screen.getByTestId('pending')).toHaveTextContent('idle')
  })

  it('abandons the navigation when the mount refuses', async () => {
    environment = mountEditor(true)
    let committed = false

    const negotiation = environment.runtime.navigator.requestNavigation(leaving(), () => {
      committed = true
    })

    await waitFor(() => {
      expect(screen.getByTestId('pending')).toHaveTextContent('/operations')
    })

    await act(async () => {
      screen.getByRole('button', { name: 'stay' }).click()
      await negotiation
    })

    expect(await negotiation).toBe('blocked')
    expect(committed).toBe(false)
  })

  it('asks per navigation, so a mount can refuse one and allow another', async () => {
    // Only a navigation that leaves this App's boundary is worth objecting to;
    // moving between its own routes loses nothing.
    environment = mountEditor(intent => intent.leavesBoundary)
    let committed = false

    const within = createNavigationIntent(
      parseBoundaryLocation('/lab/unsaved'),
      parseBoundaryLocation('/lab/storage'),
      '/lab',
    )

    const outcome = await act(
      async () =>
        await environment?.runtime.navigator.requestNavigation(within, () => {
          committed = true
        }),
    )

    expect(outcome).toBe('proceeded')
    expect(committed).toBe(true)
    expect(screen.getByTestId('pending')).toHaveTextContent('idle')
  })

  it('does not strand the host when the mount disappears mid-negotiation', async () => {
    environment = mountEditor(true)
    let committed = false

    const negotiation = environment.runtime.navigator.requestNavigation(leaving(), () => {
      committed = true
    })

    await waitFor(() => {
      expect(screen.getByTestId('pending')).toHaveTextContent('/operations')
    })

    // The editor goes away while it still owes an answer. Without the promise
    // being settled on cleanup the host would negotiate forever, and every
    // later navigation would be refused as "already negotiating".
    await act(async () => {
      screen.getByRole('button', { name: 'unmount' }).click()
      await negotiation
    })

    expect(await negotiation).toBe('proceeded')
    expect(committed).toBe(true)
    expect(environment.runtime.navigator.isNegotiating).toBe(false)
  })
})
