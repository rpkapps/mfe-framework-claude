import '@angular/compiler'
import {
  createSharedStateBackend,
  createTestSharedStateRepository,
  mountApp,
} from '@company/mfe-react/testing'
import { schema } from '@example/shared-state-contracts/schema'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'

import app from './mfe.ts'

import { wellInspection } from '../../fieldwork/src/mfe.ts'

it('shares a selection with the real Angular Widget and restores it after remount', async () => {
  const { repository } = createTestSharedStateRepository()
  const adapter = createSharedStateBackend({ schema, repository, authorize: async () => undefined })
  const options = {
    basePath: '/lab',
    initialEntries: ['/lab/shared-state'],
    definitions: [wellInspection],
    sharedState: { schema, scope: 'test', adapter },
  }
  const mounted = await mountApp(app, options)
  const page = within(mounted.element)
  const angular = page.getByRole('region', { name: 'Angular inspection app' })
  const inspection = within(angular)
  const well = await page.findByLabelText('Well')
  fireEvent.change(well, { target: { value: 'well-42' } })
  await waitFor(() => expect(page.getByText('2,450 m')).toBeInTheDocument())
  await waitFor(() => expect(well).toBeEnabled())
  expect(await inspection.findByText('North Ridge 42')).toBeInTheDocument()
  expect(angular.querySelector('[data-mfe-scope="well-inspection"]')).not.toBeNull()
  fireEvent.click(page.getByRole('switch', { name: 'Compare with baseline' }))
  await waitFor(() => expect(page.getByText('2,400 m')).toBeInTheDocument())
  const units = page.getByLabelText('Depth units')
  await waitFor(() => expect(units).toBeEnabled())
  fireEvent.click(inspection.getByRole('button', { name: 'Use feet' }))
  await waitFor(() => expect(page.getByText('8,038 ft')).toBeInTheDocument())
  await waitFor(() => expect(units).toHaveValue('imperial'))
  expect(inspection.getByText('Inspection depth: 8,038 ft')).toBeInTheDocument()
  await waitFor(() => expect(units).toBeEnabled())
  const run = page.getByLabelText('Survey run')
  await waitFor(() => expect(inspection.getByRole('button', { name: 'Use metres' })).toBeEnabled())
  const angularRun = inspection.getByRole('combobox')
  fireEvent.keyDown(angularRun, { key: 'ArrowUp', code: 'ArrowUp' })
  fireEvent.keyDown(angularRun, { key: 'ArrowUp', code: 'ArrowUp' })
  fireEvent.keyDown(angularRun, { key: 'Enter', code: 'Enter' })
  await waitFor(() => expect(run).toHaveValue('run-7'))
  await waitFor(() => expect(page.getByText('7,874 ft')).toBeInTheDocument())
  await waitFor(() => expect(run).toBeEnabled())
  fireEvent.click(page.getByRole('button', { name: 'Close inspection panel' }))
  expect(inspection.queryByText('North Ridge 42')).toBeNull()
  fireEvent.click(page.getByRole('button', { name: 'Reopen inspection panel' }))
  expect(await inspection.findByText('North Ridge 42')).toBeInTheDocument()
  expect(inspection.getByText('Inspection depth: 7,874 ft')).toBeInTheDocument()
  const [saved] = await adapter.hydrate('test', ['well:selection'], new AbortController().signal)
  expect(saved?.value).toEqual({ wellId: 'well-42', runId: 'run-7', comparisonMode: 'overlay' })
  await mounted.dispose()

  const reopened = await mountApp(app, options)
  const restored = within(reopened.element)
  expect(await restored.findByText('7,874 ft')).toBeInTheDocument()
  expect(restored.getByRole('switch', { name: 'Compare with baseline' })).toBeChecked()
  fireEvent.click(restored.getByRole('button', { name: 'Clear selected well' }))
  await waitFor(() => expect(restored.getByText('No survey selected')).toBeInTheDocument())
  await reopened.dispose()
})
