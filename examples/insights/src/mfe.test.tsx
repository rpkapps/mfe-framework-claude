/** The markup belongs to the design system, so only the contract is asserted here. */

import { renderWidget } from '@company/mfe-react/testing'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { costVsRisk, fdaSummary, wellDesign } from './mfe.tsx'

let cleanup: (() => Promise<void>) | null = null

afterEach(async () => {
  // Cleared before the await: a later test may have assigned a new handle by the time this resolves.
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
  it('mounts with the defaulted comparison and declares no outputs', () => {
    const rendered = renderWidget(costVsRisk, { props: {} })
    cleanup = rendered.dispose

    expect(Object.keys(costVsRisk.contract.outputSchema.shape)).toEqual([])
    // The header counts what `compare` selected, and the schema default selects two.
    expect(screen.getByText('2 Selected')).toBeInTheDocument()
  })
})
