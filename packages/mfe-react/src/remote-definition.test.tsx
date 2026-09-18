/**
 * A failed load must stay failed.
 *
 * Caching the rejection is what lets React surface it. A cache that evicted
 * itself on rejection handed the next render a fresh pending promise, so the
 * fallback was never reached and the manifest was refetched as fast as the
 * network allowed — measured at roughly 340 requests a second against a shell
 * whose remote was unreachable.
 */

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { AppHost } from './app-host.tsx'
import { createWidget } from './definition.ts'
import { MfeProvider } from './runtime-context.tsx'
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

/** Reaches the loader and then fails the kind check, so load attempts are countable. */
const notAnApp = createWidget({
  id: 'not-an-app',
  version: '1.0.0',
  inputs: z.object({}),
  events: {},
  render: () => null,
})

async function renderFailing(env: MfeTestEnvironment) {
  return await renderSuspending(
    <MfeProvider runtime={env.runtime}>
      <Suspense fallback={<p>Loading…</p>}>
        <AppHost
          appId="not-an-app"
          basePath="/reports"
          fallback={({ error, retry }) => (
            <div>
              <p data-testid="error">{error.message}</p>
              <button type="button" onClick={retry}>
                Retry
              </button>
            </div>
          )}
        />
      </Suspense>
    </MfeProvider>,
  )
}

describe('a load that fails', () => {
  it('surfaces the failure once instead of re-suspending on a fresh promise', async () => {
    environment = createMfeTestEnvironment({
      definitionId: 'parent-app',
      definitions: [notAnApp],
    })
    const load = vi.spyOn(environment.runtime.loader, 'load')

    await renderFailing(environment)

    await waitFor(() => expect(screen.getByTestId('error')).toBeInTheDocument())

    // The old cache dropped the rejection, so every render started another load.
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()

    // Still exactly one after the tree has had the chance to re-render.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('makes retry a genuinely fresh attempt', async () => {
    environment = createMfeTestEnvironment({
      definitionId: 'parent-app',
      definitions: [notAnApp],
    })
    const load = vi.spyOn(environment.runtime.loader, 'load')

    await renderFailing(environment)
    await waitFor(() => expect(screen.getByTestId('error')).toBeInTheDocument())
    expect(load).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // Retry drops the cached outcome; without that it would replay the same
    // rejected promise and never reach the network again.
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('error')).toBeInTheDocument()
  })
})
