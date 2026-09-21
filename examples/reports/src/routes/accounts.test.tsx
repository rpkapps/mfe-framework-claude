/** An App's router resolves its first match asynchronously, so `renderApp` returns before the route
 * has rendered and every assertion has to wait. */

import { renderApp, setMfeConfig } from '@company/mfe-react/testing'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import reports from '../mfe.ts'

let mounted: (() => Promise<void>) | null = null

afterEach(async () => {
  // Cleared before the await: a later test may have assigned a new handle by the time this resolves.
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
    expect(screen.getByText('accountId=fda-1-02')).toBeInTheDocument()
  })

  it('reads the same parameter whatever boundary it was mounted at', async () => {
    setMfeConfig({ apiBaseUrl: 'https://api.example.test/v1/' })

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
