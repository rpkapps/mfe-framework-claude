import '@angular/compiler'
import { createMemoryUserStorage, mountApp } from '@company/mfe-react/testing'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'

import app from './mfe.ts'

import { wellInspection } from '../../fieldwork/src/mfe.ts'

it('shares the Lab’s selection with the real Angular Widget and restores both after remount', async () => {
  const user = createMemoryUserStorage()
  const options = {
    basePath: '/lab',
    initialEntries: ['/lab/user-storage'],
    definitions: [wellInspection],
    storage: { user },
  }
  const mounted = await mountApp(app, options)
  const page = within(mounted.element)
  const angular = page.getByRole('region', { name: 'Angular inspection app' })
  const inspection = within(angular)
  fireEvent.change(await page.findByLabelText('Well'), { target: { value: 'well-42' } })
  await waitFor(() => expect(page.getByText('2,450 m')).toBeInTheDocument())
  expect(await inspection.findByText('North Ridge 42')).toBeInTheDocument()
  expect(angular.querySelector('[data-mfe-scope="well-inspection"]')).not.toBeNull()
  fireEvent.click(page.getByRole('switch', { name: 'Compare with baseline' }))
  await waitFor(() => expect(page.getByText('2,400 m')).toBeInTheDocument())
  fireEvent.change(page.getByLabelText('Depth units'), { target: { value: 'imperial' } })
  await waitFor(() =>
    expect(inspection.getByText('Inspection depth: 8,038 ft')).toBeInTheDocument(),
  )
  fireEvent.change(page.getByLabelText('Survey run'), { target: { value: 'run-7' } })
  await waitFor(() =>
    expect(inspection.getByText('Inspection depth: 7,874 ft')).toBeInTheDocument(),
  )
  fireEvent.click(inspection.getByRole('button', { name: 'Prepare inspection' }))
  expect(await inspection.findByRole('region', { name: 'Inspection brief' })).toHaveTextContent(
    'Baseline survey',
  )
  fireEvent.click(page.getByRole('button', { name: 'Close inspection panel' }))
  expect(inspection.queryByText('North Ridge 42')).toBeNull()
  fireEvent.click(page.getByRole('button', { name: 'Reopen inspection panel' }))
  expect(await inspection.findByText('North Ridge 42')).toBeInTheDocument()
  expect(await inspection.findByRole('region', { name: 'Inspection brief' })).toHaveTextContent(
    'Baseline survey',
  )
  // Each owner's keys are their own rows.
  await waitFor(() =>
    expect(user.snapshot()['lab']?.['well-selection']?.d).toEqual({
      wellId: 'well-42',
      runId: 'run-7',
      comparisonMode: 'overlay',
    }),
  )
  expect(user.snapshot()['lab']?.['units']?.d).toBe('imperial')
  expect(user.snapshot()['well-inspection']?.['brief']?.d).toMatchObject({ runId: 'run-7' })
  await mounted.dispose()

  const reopened = await mountApp(app, options)
  const restored = within(reopened.element)
  expect(await restored.findByText('7,874 ft')).toBeInTheDocument()
  expect(restored.getByRole('switch', { name: 'Compare with baseline' })).toBeChecked()
  expect(await restored.findByRole('region', { name: 'Inspection brief' })).toHaveTextContent(
    'Baseline survey',
  )
  fireEvent.click(restored.getByRole('button', { name: 'Clear selected well' }))
  await waitFor(() => expect(restored.getByText('No survey selected')).toBeInTheDocument())
  await reopened.dispose()
})

it('shows a selection while it saves, and rolls back and reports a rejected save', async () => {
  const user = createMemoryUserStorage()
  let release!: () => void
  const acknowledgement = new Promise<void>(resolve => {
    release = resolve
  })
  let rejectSave = false
  const mounted = await mountApp(app, {
    basePath: '/lab',
    initialEntries: ['/lab/user-storage'],
    definitions: [wellInspection],
    storage: {
      user: {
        load: user.load,
        async save(owner, key, value, signal) {
          if (rejectSave) throw new Error('Storage is unavailable')
          await acknowledgement
          return await user.save(owner, key, value, signal)
        },
      },
    },
  })
  const page = within(mounted.element)
  const well = await page.findByLabelText('Well')
  fireEvent.change(well, { target: { value: 'well-42' } })
  // Optimistic: the choice shows at once, before the backend has stored it.
  await waitFor(() => expect(well).toHaveValue('well-42'))
  expect(await page.findByText('2,450 m')).toBeInTheDocument()
  release()
  await waitFor(() => expect(user.snapshot()['lab']?.['well-selection']).toBeDefined())

  rejectSave = true
  fireEvent.change(page.getByLabelText('Depth units'), { target: { value: 'imperial' } })
  expect(await page.findByText(/Storage is unavailable/)).toBeInTheDocument()
  expect(page.getByLabelText('Depth units')).toHaveValue('metric')
  expect(page.getByText('2,450 m')).toBeInTheDocument()
  await mounted.dispose()
})
