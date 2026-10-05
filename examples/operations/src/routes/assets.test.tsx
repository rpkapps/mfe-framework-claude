/** Nothing here is a second configuration API: the source imports `#mfe/fetch` exactly as it ships,
 * and only the test runner's resolution points at a fixture. */

import {
  mfeRequests,
  renderApp,
  setMfeAccessToken,
  setMfeApiBaseUrl,
  setMfeConfig,
  setMfeFetch,
} from '@company/mfe-react/testing'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import operations from '../mfe.ts'

let mounted: (() => Promise<void>) | null = null

afterEach(async () => {
  // Cleared before the await: a later test may have assigned a new handle by the time this resolves.
  const dispose = mounted
  mounted = null
  await dispose?.()
  vi.restoreAllMocks()
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ASSETS = [
  { id: 'a-1', name: 'Pump 4', status: 'operational' },
  { id: 'a-2', name: 'Separator 2', status: 'degraded' },
]

const API = 'https://api.example.test/v1/'

/**
 * In development, React reports on the console the error a route's boundary caught, and the router
 * the match that failed. A test of a failing load captures both and checks them, so the run prints
 * only what fails unexpectedly.
 */
function captureBoundaryReport(): { expectReported(message: RegExp): void } {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  return {
    expectReported(message) {
      expect(error).toHaveBeenCalledOnce()
      expect(error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ message: expect.stringMatching(message) }),
        expect.stringContaining('The above error occurred'),
        expect.any(String),
      )
      expect(warn).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Error in route match: /assets'))
    },
  }
}

/** What the deployment would supply, and the base a relative request resolves against. */
function configured(): void {
  setMfeConfig({ apiBaseUrl: API, telemetryEnabled: false })
  setMfeApiBaseUrl(API)
}

describe('the assets route', () => {
  it('renders what the API returned', async () => {
    configured()
    setMfeFetch(() => json(ASSETS))

    const rendered = renderApp(operations, { initialEntries: ['/assets'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(screen.getByText('Pump 4')).toBeInTheDocument()
    })
    expect(screen.getByText('Separator 2')).toBeInTheDocument()
    expect(screen.getByText('degraded')).toBeInTheDocument()
  })

  it('resolves the request against the API base, not the document', async () => {
    configured()
    setMfeFetch(() => json([]))

    const rendered = renderApp(operations, { initialEntries: ['/assets?site=south'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(mfeRequests()).toHaveLength(1)
    })
    // The URL that actually goes out: the source passes 'assets?site=south'
    // and the interceptor resolves it under the configured base (§10.4).
    expect(mfeRequests()[0]?.url).toBe('https://api.example.test/v1/assets?site=south')
  })

  it('attaches the session token to the declared API origin', async () => {
    configured()
    setMfeAccessToken('token-7')
    setMfeFetch(() => json([]))

    const rendered = renderApp(operations, { initialEntries: ['/assets'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(mfeRequests()).toHaveLength(1)
    })
    expect(mfeRequests()[0]?.authorization).toBe('Bearer token-7')
  })

  it('sends no Authorization header when the shell has no session', async () => {
    configured()
    setMfeAccessToken(null)
    setMfeFetch(() => json([]))

    const rendered = renderApp(operations, { initialEntries: ['/assets'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(mfeRequests()).toHaveLength(1)
    })
    expect(mfeRequests()[0]?.authorization).toBeNull()
  })

  it('defaults the site when the URL omits it', async () => {
    configured()
    setMfeFetch(() => json([]))

    const rendered = renderApp(operations, { initialEntries: ['/assets'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(mfeRequests()).toHaveLength(1)
    })
    // The schema default, applied by the route's own validateSearch.
    expect(mfeRequests()[0]?.url).toBe('https://api.example.test/v1/assets?site=north')
  })

  it('surfaces an unsuccessful response as an error rather than an empty table', async () => {
    configured()
    const report = captureBoundaryReport()
    setMfeFetch(() => new Response('', { status: 503, statusText: 'Service Unavailable' }))

    const rendered = renderApp(operations, { initialEntries: ['/assets'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(screen.getByText(/Loading assets for site north failed with 503/)).toBeInTheDocument()
    })
    report.expectReported(/failed with 503 Service Unavailable/)
  })

  it('runs the loader again on Try again, so a recovered API renders its data', async () => {
    configured()
    const report = captureBoundaryReport()
    let calls = 0
    setMfeFetch(() => {
      calls += 1
      return calls === 1
        ? new Response('', { status: 503, statusText: 'Service Unavailable' })
        : json(ASSETS)
    })

    const rendered = renderApp(operations, { initialEntries: ['/assets'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(screen.getByText('This page could not load its data')).toBeInTheDocument()
    })
    report.expectReported(/failed with 503 Service Unavailable/)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(screen.getByText('Pump 4')).toBeInTheDocument()
    })
    expect(mfeRequests()).toHaveLength(2)
  })

  it('shows Refreshing… only once a refresh has run past the busy delay', async () => {
    configured()
    let calls = 0
    let respond = (): void => undefined
    // The first request answers at once; the refresh waits until the test lets it go.
    setMfeFetch(() => {
      calls += 1
      if (calls === 1) return json(ASSETS)
      return new Promise<Response>(resolve => {
        respond = () => {
          resolve(json(ASSETS))
        }
      })
    })

    const rendered = renderApp(operations, { initialEntries: ['/assets'] })
    mounted = rendered.dispose
    await waitFor(() => {
      expect(screen.getByText('Pump 4')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    // Locked from the first click, before the delayed busy state has shown.
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-disabled', 'true')

    const refreshing = await screen.findByRole('button', { name: /Refreshing…/ })
    expect(refreshing).toHaveAttribute('aria-disabled', 'true')

    respond()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      )
    })
  })
})

describe('the generated-alias fixtures', () => {
  it('refuses a relative request when no base is configured', async () => {
    setMfeConfig({ apiBaseUrl: API, telemetryEnabled: false })
    const report = captureBoundaryReport()
    // Deliberately no setMfeApiBaseUrl: this is the deployment that forgot to
    // supply the base, and it has to fail before any request goes out (§10.4).
    setMfeFetch(() => json([]))

    const rendered = renderApp(operations, { initialEntries: ['/assets'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(screen.getByText(/apiBaseUrl/)).toBeInTheDocument()
    })
    expect(mfeRequests()).toHaveLength(0)
    report.expectReported(/received the relative URL "assets\?site=north"/)
  })
})
