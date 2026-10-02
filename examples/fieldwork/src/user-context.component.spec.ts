import { runInInjectionContext } from '@angular/core'
import { Router } from '@angular/router'
import {
  createUserContextBackend,
  createTestUserContextRepository,
  mountApp,
  mountWidget,
} from '@company/mfe-angular/testing'
import { schema } from '@example/user-context-demo/schema'
import { expect, it } from 'vitest'
import { injectUserContext } from '#mfe/user-context/well-inspection'
import { fieldwork as app, wellInspection } from './mfe'

async function state() {
  const { repository } = createTestUserContextRepository()
  const backend = (owner: string) =>
    createUserContextBackend({
      schema,
      repository,
      resolveOwner: async () => owner,
      authorize: async () => undefined,
    })
  const lab = backend('lab')
  const adapter = lab
  await lab.write(
    {
      scope: 'test',
      id: 'lab',
      expectedRevision: 0,
      operationId: 'react-selection',
      value: {
        'display:units': 'imperial',
        'well:selection': { wellId: 'well-42', runId: 'run-8', comparisonMode: 'overlay' },
      },
    },
    new AbortController().signal,
  )
  return { schema, scope: 'test', adapter }
}

it('reads Lab without a setter and prepares a local inspection brief', async () => {
  const userContext = await state()
  const mounted = await mountWidget(wellInspection, { userContext })
  expect(mounted.element.textContent).toContain('North Ridge 42')
  expect(mounted.element.textContent).toContain('Inspection depth: 8,038 ft')
  const foreign = runInInjectionContext(mounted.injector, () =>
    injectUserContext('lab', context => context['well:selection']),
  )
  expect(foreign).not.toHaveProperty('set')
  expect(foreign.value()?.comparisonMode).toBe('overlay')
  const prepare = [...mounted.element.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    button.textContent?.includes('Prepare inspection'),
  )!
  prepare.click()
  await expect
    .poll(async () => {
      await mounted.whenStable()
      return mounted.element.textContent
    })
    .toContain('Inspect North Ridge 42 at North Ridge pad, using October survey at 8,038 ft.')
  const saved = await userContext.adapter.hydrate('test', ['lab'], new AbortController().signal)
  expect(saved[0]?.value).toMatchObject({
    'well:selection': { comparisonMode: 'overlay', runId: 'run-8' },
  })
  await mounted.dispose()
})

it('hydrates the explicitly declared Lab slice before Fieldwork route resolvers run', async () => {
  const mounted = await mountApp(app, {
    basePath: '/fieldwork',
    initialEntries: ['/fieldwork/user-context'],
    definitions: [wellInspection],
    userContext: await state(),
  })
  const route = mounted.injector.get(Router).routerState.snapshot.root.firstChild
  expect(route?.data['selection']).toMatchObject({
    wellId: 'well-42',
    runId: 'run-8',
    comparisonMode: 'overlay',
  })
  await expect.poll(() => mounted.element.textContent).toContain('North Ridge 42')
  await mounted.dispose()
})
