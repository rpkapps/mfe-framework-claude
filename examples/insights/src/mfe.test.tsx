/**
 * The contracts this container publishes, checked the way a consumer meets
 * them: inputs in, declared events out, and a rejection at the provider when
 * the inputs are wrong.
 *
 * The markup is the design system's and is not re-asserted here. What belongs
 * to this container is the contract, and that a host reading the registry can
 * satisfy it — the enum members below are exactly what the shell's catalogue
 * offers as a dropdown.
 */

import { renderWidget } from '@company/mfe-react/testing'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { agentPanel, costVsRisk, fdaSummary, wellDesign } from './mfe.tsx'

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  // Cleared before the await, not after: a second test may have assigned a new
  // handle by the time this one resolves, and clearing then would drop it.
  const dispose = cleanup
  cleanup = null
  await dispose?.()
})

describe('fda-summary', () => {
  it('renders the alternative its input names', () => {
    const rendered = renderWidget(fdaSummary, { props: { fdaId: 'fda-2-3' } })
    cleanup = rendered.dispose

    expect(screen.getByText('FDA 2.3')).toBeInTheDocument()
  })

  it('emits a validated selection', async () => {
    const onSelected = vi.fn()
    const rendered = renderWidget(fdaSummary, {
      props: { fdaId: 'fda-1-02', onSelected },
    })
    cleanup = rendered.dispose

    await userEvent.click(screen.getAllByRole('checkbox')[0] as HTMLElement)

    expect(onSelected).toHaveBeenCalledWith({ fdaId: 'fda-1-02', selected: true })
  })

  it('applies the schema default for an omitted optional input', () => {
    const rendered = renderWidget(fdaSummary, { props: { fdaId: 'fda-1-2' } })
    cleanup = rendered.dispose

    // showActions defaults to true, so the Open action is present.
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
  })

  it('rejects an id outside the declared enum, naming the field', () => {
    expect(() => renderWidget(fdaSummary, { props: { fdaId: 'fda-9-9' } })).toThrowError(
      /fda-summary@1\.0\.0 failed to accept input fdaId/s,
    )
  })
})

describe('well-design', () => {
  it('renders the design its input names and emits on view', async () => {
    const onViewed = vi.fn()
    const rendered = renderWidget(wellDesign, { props: { wellId: 'reduced-dls', onViewed } })
    cleanup = rendered.dispose

    expect(screen.getByText('Reduced DLS')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /View design/i }))
    expect(onViewed).toHaveBeenCalledWith({ wellId: 'reduced-dls', well: '34/10-A-12 H' })
  })
})

describe('cost-vs-risk', () => {
  it('mounts with the defaulted comparison and declares no events', () => {
    const rendered = renderWidget(costVsRisk, { props: {} })
    cleanup = rendered.dispose

    expect(Object.keys(costVsRisk.contract.events)).toEqual([])
    // The panel's own header counts what the `compare` input selected, and the
    // schema default selects two.
    expect(screen.getByText('2 Selected')).toBeInTheDocument()
  })
})

describe('agent-panel', () => {
  it('takes a heading with a default', () => {
    const rendered = renderWidget(agentPanel, { props: {} })
    cleanup = rendered.dispose

    expect(screen.getByText('AI Agent')).toBeInTheDocument()
  })
})
