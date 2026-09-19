/**
 * A child App reads its own URL contract, and reads the same URL whatever
 * boundary it was mounted at. The two cases below are the whole claim: the
 * route sees `accountId` and never the mount prefix.
 *
 * Each assertion waits: an App's router resolves its first match
 * asynchronously, so `renderApp` returns before the route has rendered.
 */

import { renderApp, setMfeConfig } from '@company/mfe-react/testing'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import reports from '../mfe.ts'

let mounted: (() => Promise<void>) | null = null

afterEach(async () => {
  // Cleared before the await, not after: a second test may have assigned a new
  // handle by the time this one resolves, and clearing then would drop it.
  const dispose = mounted
  mounted = null
  await dispose?.()
})

describe('the account report route', () => {
  it('reads its path parameter from its own URL', async () => {
    setMfeConfig({ apiBaseUrl: 'https://api.example.test/v1/' })

    const rendered = renderApp(reports, { initialEntries: ['/accounts/fda-1-02'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(screen.getByText('Satellite drill locations')).toBeInTheDocument()
    })
    // The parameter itself, as the page read it — not a name that could have
    // come from anywhere.
    expect(screen.getByText('accountId=fda-1-02')).toBeInTheDocument()
  })

  it('reads the same parameter whatever boundary it was mounted at', async () => {
    setMfeConfig({ apiBaseUrl: 'https://api.example.test/v1/' })

    // The URL below the boundary is identical; only the prefix the host
    // assigned differs, and the child never sees it.
    const rendered = renderApp(reports, {
      basePath: '/workspace/reports',
      initialEntries: ['/accounts/fda-1-02'],
    })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(screen.getByText('accountId=fda-1-02')).toBeInTheDocument()
    })
  })

  it('reports an id it has no alternative for, rather than rendering an empty page', async () => {
    setMfeConfig({ apiBaseUrl: 'https://api.example.test/v1/' })

    const rendered = renderApp(reports, { initialEntries: ['/accounts/42'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(screen.getByText('No alternative with that id')).toBeInTheDocument()
    })
  })

  it('renders its index when the splat is empty', async () => {
    setMfeConfig({ apiBaseUrl: 'https://api.example.test/v1/' })

    const rendered = renderApp(reports, { initialEntries: ['/'] })
    mounted = rendered.dispose

    await waitFor(() => {
      expect(screen.getByText('Alternatives ranking')).toBeInTheDocument()
    })
  })
})
