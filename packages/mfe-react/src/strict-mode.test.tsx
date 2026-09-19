/**
 * Mounting under StrictMode.
 *
 * React mounts, unmounts and mounts again without re-rendering, and a mount
 * built once and torn down in an effect cleanup does not survive that — the
 * second setup gets the same handle, already disposed. Everything the mount
 * owns is then dead while the App renders happily on top of it: the signal is
 * aborted, the Query cache is cleared and cancels anything put into it, the
 * overlay root is gone.
 *
 * It is a development-only failure with a production-shaped symptom, which is
 * why it is pinned here rather than left to be noticed on a page.
 */

import { screen, waitFor } from '@testing-library/react'
import { StrictMode, Suspense, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createWidget } from './definition.ts'
import { lazyWidget } from './lazy-widget.tsx'
import { MfeProvider } from './runtime-context.tsx'
import { useMfeSignal } from './hooks/services.ts'
import { useMfeMount } from './mount-context.tsx'
import {
  createMfeTestEnvironment,
  renderSuspending,
  type MfeTestEnvironment,
} from './testing/index.tsx'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

/** Reports the state of everything the mount owns, from inside the mount. */
const reporter = createWidget({
  id: 'reporter-widget',
  version: '1.0.0',
  inputs: z.object({}),
  events: {},
  render: function Reporter(): ReactNode {
    const aborted = useMfeSignal().aborted
    const mount = useMfeMount('the reporter widget')
    const cache = mount.queryClient.getQueryCache()
    cache.build(mount.queryClient, { queryKey: ['probe'], queryFn: () => 'v' })

    return (
      <dl>
        <dt>aborted</dt>
        <dd data-testid="aborted">{String(aborted)}</dd>
        <dt>overlay attached</dt>
        <dd data-testid="overlay">{String(mount.overlayRoot.isConnected)}</dd>
        <dt>query cache usable</dt>
        <dd data-testid="cache">{String(cache.find({ queryKey: ['probe'] }) !== undefined)}</dd>
      </dl>
    )
  },
})

const Reporter = lazyWidget('reporter-widget')

describe('a mount under StrictMode', () => {
  it('is alive after React unmounts and remounts it', async () => {
    environment = createMfeTestEnvironment({ definitionId: 'host', definitions: [reporter] })

    await renderSuspending(
      (
        <StrictMode>
          <MfeProvider runtime={environment.runtime}>
            <Suspense fallback={null}>
              <Reporter />
            </Suspense>
          </MfeProvider>
        </StrictMode>
      ) as ReactNode,
    )

    await waitFor(() => {
      expect(screen.getByTestId('aborted')).toBeInTheDocument()
    })

    // Every one of these is false or missing when the App is running on the
    // mount React tore down during its double-invoke.
    expect(screen.getByTestId('aborted')).toHaveTextContent('false')
    expect(screen.getByTestId('overlay')).toHaveTextContent('true')
    expect(screen.getByTestId('cache')).toHaveTextContent('true')
  })
})
