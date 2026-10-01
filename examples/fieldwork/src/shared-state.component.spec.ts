import {
  createSharedStateBackend,
  createTestSharedStateRepository,
  mountApp,
} from '@company/mfe-angular/testing'
import { schema } from '@example/shared-state-contracts/schema'
import { expect, it } from 'vitest'

import app from './mfe'

it('hydrates before its resolver and preserves the well and overlay when changing only the run', async () => {
  const { repository } = createTestSharedStateRepository()
  const adapter = createSharedStateBackend({ schema, repository, authorize: async () => undefined })
  const signal = new AbortController().signal
  await adapter.write(
    {
      scope: 'test',
      id: 'well:selection',
      expectedRevision: 0,
      operationId: 'react-selection',
      value: { wellId: 'well-42', runId: 'run-7', comparisonMode: 'overlay' },
    },
    signal,
  )
  const mounted = await mountApp(app, {
    basePath: '/fieldwork',
    initialEntries: ['/fieldwork/shared-state'],
    sharedState: { schema, scope: 'test', adapter },
  })
  expect(mounted.element.textContent).toContain('The route resolver read well-42')
  const button = [...mounted.element.querySelectorAll<HTMLButtonElement>('button')].find(element =>
    element.textContent?.includes('Change only run'),
  )
  expect(button).toBeDefined()
  button!.click()
  await expect
    .poll(async () => {
      await mounted.whenStable()
      return mounted.element.textContent
    })
    .toContain('Run: run-8')
  expect(mounted.element.textContent).toContain('Well: well-42')
  expect(mounted.element.textContent).toContain('Comparison: overlay')
  const [saved] = await adapter.hydrate('test', ['well:selection'], signal)
  expect(saved?.value).toEqual({ wellId: 'well-42', runId: 'run-8', comparisonMode: 'overlay' })
  await mounted.dispose()
})
