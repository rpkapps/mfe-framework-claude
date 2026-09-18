/**
 * A component test written the way an author writes one: explicit fixtures,
 * no running shell, no live credentials, no federation.
 */

import { renderWidget } from '@company/mfe-react/testing'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { alertPanel } from './mfe.tsx'

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  // Cleared before the await, not after: a second test may have assigned a new
  // handle by the time this one resolves, and clearing then would drop it.
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
      // Names the field, the offending value, the owning side and the repair.
      // The connective wording is zod's and is deliberately not pinned here.
      /alert-panel@1\.4\.0 failed to accept input alertId.*\b7\b.*The Widget provider declares this expectation.*Check the alertId prop/s,
    )
  })

  it('does not forward host control props as inputs', async () => {
    const rendered = renderWidget(alertPanel, {
      props: { alertId: 'a-2', fallback: () => null },
    })
    cleanup = rendered.dispose

    // `fallback` is a host control prop; reaching the schema would have failed
    // validation, so rendering at all proves it was filtered out.
    expect(screen.getByText('Alert a-2')).toBeInTheDocument()
  })
})
