/**
 * Shell state read from the host's own chrome.
 *
 * The host is the side that publishes the theme, and it renders a header, a
 * settings sheet and a palette that all have to show the same one. Requiring a
 * mount meant it could not read its own value back through the framework, so
 * it subscribed to the store by hand instead — a second implementation of a
 * published contract, in the one place where disagreeing with it is visible.
 */

import { render, renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import { MfeProvider } from '../runtime-context.tsx'
import { createMfeTestEnvironment, type MfeTestEnvironment } from '../testing/index.tsx'
import { useTheme, useUser } from './shell-state.ts'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

/** The provider alone: what the shell's own chrome renders inside. */
function hostOnly(created: MfeTestEnvironment) {
  return ({ children }: { readonly children: ReactNode }): ReactNode => (
    <MfeProvider runtime={created.runtime}>{children}</MfeProvider>
  )
}

describe('shell state outside a mount', () => {
  it('reads the published theme from the host’s own chrome', () => {
    environment = createMfeTestEnvironment({ shellState: { theme: 'dark' } })

    const { result } = renderHook(() => useTheme(), { wrapper: hostOnly(environment) })

    expect(result.current).toBe('dark')
  })

  it('re-renders the chrome when the theme it published changes', () => {
    environment = createMfeTestEnvironment({ shellState: { theme: 'light' } })
    const created = environment

    const { result } = renderHook(() => useTheme(), { wrapper: hostOnly(created) })

    act(() => {
      created.runtime.shellState.apply({ theme: 'dark' })
    })

    expect(result.current).toBe('dark')
  })

  it('gives the mount and the chrome the same answer', () => {
    environment = createMfeTestEnvironment({ shellState: { theme: 'dark' } })
    const created = environment

    function Both(): ReactNode {
      return <span data-testid="theme">{useTheme()}</span>
    }

    const Mounted = created.wrapper
    const view = render(
      <>
        <MfeProvider runtime={created.runtime}>
          <Both />
        </MfeProvider>
        <Mounted>
          <Both />
        </Mounted>
      </>,
    )

    const [chrome, mounted] = view.getAllByTestId('theme')
    expect(chrome?.textContent).toBe('dark')
    expect(mounted?.textContent).toBe('dark')
  })

  it('reads the signed-in user from the host’s own chrome', () => {
    environment = createMfeTestEnvironment({
      shellState: { user: { id: 'u-1', name: 'Robin Kolesnik' } },
    })

    const { result } = renderHook(() => useUser(), { wrapper: hostOnly(environment) })

    expect(result.current?.name).toBe('Robin Kolesnik')
  })
})
