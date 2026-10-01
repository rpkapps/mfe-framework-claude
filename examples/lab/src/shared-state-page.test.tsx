import {
  createSharedStateBackend,
  createTestSharedStateRepository,
  mountApp,
} from '@company/mfe-react/testing'
import { schema } from '@example/shared-state-contracts/schema'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'

import app from './mfe.ts'

it('shares units between subscribers and preserves the well and overlay when changing only a run', async () => {
  const { repository } = createTestSharedStateRepository()
  const adapter = createSharedStateBackend({ schema, repository, authorize: async () => undefined })
  const mounted = await mountApp(app, {
    basePath: '/lab',
    initialEntries: ['/lab/shared-state'],
    sharedState: { schema, scope: 'test', adapter },
  })
  const page = within(mounted.element)
  await page.findByRole('button', { name: 'Switch units' })

  async function choose(name: string) {
    const button = page.getByRole('button', { name })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeEnabled())
  }

  await choose('Switch units')
  expect(page.getByText('Another subscriber reads imperial units.')).toBeInTheDocument()
  await choose('Select well 42')
  await choose('Enable overlay')
  await choose('Change only run')
  expect(page.getByText('run-8')).toBeInTheDocument()
  expect(page.getByText('overlay')).toBeInTheDocument()
  // Both the hook and the route loader see the selected well.
  expect(page.getAllByText('well-42')).toHaveLength(2)
  await mounted.dispose()

  const reopened = await mountApp(app, {
    basePath: '/lab',
    initialEntries: ['/lab/shared-state'],
    sharedState: { schema, scope: 'test', adapter },
  })
  const restored = within(reopened.element)
  expect(await restored.findByText('run-8')).toBeInTheDocument()
  expect(restored.getByText('overlay')).toBeInTheDocument()
  fireEvent.click(restored.getByRole('button', { name: 'Clear selection' }))
  await waitFor(() => expect(restored.queryByText('well-42')).toBeNull())
  await reopened.dispose()
})
