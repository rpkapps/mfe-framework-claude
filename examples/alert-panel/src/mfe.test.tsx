import { renderWidget } from '@company/mfe-react/testing'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { alertPanel } from './mfe.ts'

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  // Cleared before the await: a later test may have assigned a new handle by the time this resolves.
  const dispose = cleanup
  cleanup = null
  await dispose?.()
})

describe('alert-panel', () => {
  it('renders the alert and emits a validated acknowledgement', async () => {
    const onAcknowledged = vi.fn()
    const rendered = renderWidget(alertPanel, {
      props: { alertId: 'a-42', severity: 'critical', onAcknowledged },
    })
    cleanup = rendered.dispose

    expect(screen.getByText('Alert a-42')).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }))

    expect(onAcknowledged).toHaveBeenCalledTimes(1)
    const payload = onAcknowledged.mock.calls[0]?.[0] as {
      alertId: string
      acknowledgedAt: string
    }
    expect(payload.alertId).toBe('a-42')
    expect(typeof payload.acknowledgedAt).toBe('string')
  })

  it('applies a schema default for an omitted optional input', async () => {
    const rendered = renderWidget(alertPanel, { props: { alertId: 'a-1' } })
    cleanup = rendered.dispose

    expect(screen.getByText('Informational')).toBeInTheDocument()
  })

  it('rejects an invalid input at the provider boundary with an actionable message', () => {
    expect(() => renderWidget(alertPanel, { props: { alertId: 7 } })).toThrowError(
      // The connective wording is zod's and is deliberately not pinned here.
      /alert-panel@1\.4\.0 failed to accept input alertId.*\b7\b.*Check the alertId prop/s,
    )
  })

  it('does not forward host control props as inputs', async () => {
    const rendered = renderWidget(alertPanel, {
      props: { alertId: 'a-2', fallback: () => null },
    })
    cleanup = rendered.dispose

    expect(screen.getByText('Alert a-2')).toBeInTheDocument()
  })
})
