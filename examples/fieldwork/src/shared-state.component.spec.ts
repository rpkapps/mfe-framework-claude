import { runInInjectionContext } from '@angular/core'
import { Router } from '@angular/router'
import {
  createSharedStateBackend,
  createTestSharedStateRepository,
  mountApp,
  mountWidget,
} from '@company/mfe-angular/testing'
import { schema } from '@example/shared-state-contracts/schema'
import { expect, it } from 'vitest'

import { injectSharedStateStore } from '#mfe/shared-state/well-inspection'
import { fieldwork as app, wellInspection } from './mfe'

async function state() {
  const { repository } = createTestSharedStateRepository()
  const adapter = createSharedStateBackend({ schema, repository, authorize: async () => undefined })
  await adapter.write(
    {
      scope: 'test',
      id: 'well:selection',
      expectedRevision: 0,
      operationId: 'react-selection',
      value: { wellId: 'well-42', runId: 'run-7', comparisonMode: 'overlay' },
    },
    new AbortController().signal,
  )
  return { schema, scope: 'test', adapter }
}

it('uses the shared well in an inspection, converts depth and preserves comparison when changing the run', async () => {
  const sharedState = await state()
  const mounted = await mountWidget(wellInspection, { sharedState })
  expect(mounted.element.textContent).toContain('North Ridge 42')
  expect(mounted.element.textContent).toContain('Inspection depth: 2,400 m')
  const store = runInInjectionContext(mounted.injector, () => injectSharedStateStore())
  await store.set('well:selection', { runId: 'run-8' })
  await mounted.whenStable()
  expect(mounted.element.textContent).toContain('October survey')
  expect(mounted.element.textContent).toContain('Baseline comparison: On')
  const feet = [...mounted.element.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    button.textContent?.includes('Use feet'),
  )!
  feet.click()
  await expect
    .poll(async () => {
      await mounted.whenStable()
      return mounted.element.textContent
    })
    .toContain('8,038 ft')
  const prepare = [...mounted.element.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    button.textContent?.includes('Prepare inspection'),
  )!
  prepare.click()
  await mounted.whenStable()
  expect(mounted.element.textContent).toContain(
    'Inspect North Ridge 42 at North Ridge pad, using October survey at 8,038 ft.',
  )
  const [saved] = await sharedState.adapter.hydrate(
    'test',
    ['well:selection'],
    new AbortController().signal,
  )
  expect(saved?.value).toEqual({ wellId: 'well-42', runId: 'run-8', comparisonMode: 'overlay' })
  await mounted.dispose()
})

it('hydrates the shared selection before the Fieldwork route resolver runs', async () => {
  const mounted = await mountApp(app, {
    basePath: '/fieldwork',
    initialEntries: ['/fieldwork/shared-state'],
    definitions: [wellInspection],
    sharedState: await state(),
  })
  const route = mounted.injector.get(Router).routerState.snapshot.root.firstChild
  expect(route?.data['selection']).toMatchObject({
    wellId: 'well-42',
    runId: 'run-7',
    comparisonMode: 'overlay',
  })
  await expect.poll(() => mounted.element.textContent).toContain('North Ridge 42')
  await mounted.dispose()
})
