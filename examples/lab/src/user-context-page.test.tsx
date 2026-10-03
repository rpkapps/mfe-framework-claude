import '@angular/compiler'
import {
  createUserContextBackend,
  type MemoryRuntimeOptions,
  createTestUserContextRepository,
  mountApp,
} from '@company/mfe-react/testing'
import labRegistry from '../.mfe/mfe-registry.json'
import fieldworkRegistry from '../../fieldwork/.mfe/mfe-registry.json'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'

import app from './mfe.ts'
import { wellInspection } from '../../fieldwork/src/mfe.ts'

// Canonical contracts come from the same generated registry artifacts deployed by each owner.
const generatedSchema = {
  formatVersion: 1,
  contracts: [...labRegistry.definitions, ...fieldworkRegistry.definitions].flatMap(definition =>
    'userContextContract' in definition ? [definition.userContextContract] : [],
  ),
}
const schema = generatedSchema as NonNullable<MemoryRuntimeOptions['userContext']>['schema']

it('reads Lab context in Angular and restores the durable selection after remount', async () => {
  const { repository } = createTestUserContextRepository()
  const backend = (owner: string) =>
    createUserContextBackend({
      repository,
      resolveOwner: async () => owner,
      authorize: async () => undefined,
    })
  const lab = backend('lab')
  const widget = backend('well-inspection')
  // The fixture selects the fixed-owner backend used by each demo endpoint.
  const adapter = {
    hydrate: lab.hydrate,
    write: (operation: Parameters<typeof lab.write>[0], signal: AbortSignal) =>
      (operation.id === 'well-inspection' ? widget : lab).write(operation, signal),
  }
  const options = {
    basePath: '/lab',
    initialEntries: ['/lab/user-context'],
    definitions: [wellInspection],
    userContext: { schema, scope: 'test', adapter },
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
  const records = await adapter.hydrate('test', ['lab'], new AbortController().signal)
  expect(records[0]?.value).toEqual({
    units: 'imperial',
    'well-selection': { wellId: 'well-42', runId: 'run-7', comparisonMode: 'overlay' },
  })
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

it('keeps the committed selection visible while saving and reports a rejected write', async () => {
  const { repository } = createTestUserContextRepository()
  const backend = createUserContextBackend({
    repository,
    resolveOwner: async () => 'lab',
    authorize: async () => undefined,
  })
  let release!: () => void
  const acknowledgement = new Promise<void>(resolve => {
    release = resolve
  })
  let rejectWrite = false
  const mounted = await mountApp(app, {
    basePath: '/lab',
    initialEntries: ['/lab/user-context'],
    definitions: [wellInspection],
    userContext: {
      schema,
      scope: 'test',
      adapter: {
        hydrate: backend.hydrate,
        async write(operation, signal) {
          if (rejectWrite) throw new Error('Storage is unavailable')
          await acknowledgement
          return await backend.write(operation, signal)
        },
      },
    },
  })
  const page = within(mounted.element)
  const well = await page.findByLabelText('Well')
  fireEvent.change(well, { target: { value: 'well-42' } })
  expect(well).toHaveValue('')
  expect(page.getByText('No survey selected')).toBeInTheDocument()
  release()
  await waitFor(() => expect(well).toHaveValue('well-42'))
  expect(await page.findByText('2,450 m')).toBeInTheDocument()

  rejectWrite = true
  fireEvent.change(page.getByLabelText('Depth units'), { target: { value: 'imperial' } })
  expect(await page.findByText(/Storage is unavailable/)).toBeInTheDocument()
  expect(page.getByLabelText('Depth units')).toHaveValue('metric')
  expect(page.getByText('2,450 m')).toBeInTheDocument()
  await mounted.dispose()
})
