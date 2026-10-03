import { runInInjectionContext } from '@angular/core'
import { Router } from '@angular/router'
import {
  createUserContextBackend,
  type MemoryRuntimeOptions,
  createTestUserContextRepository,
  mountApp,
  mountWidget,
} from '@company/mfe-angular/testing'
import labRegistry from '../../lab/.mfe/mfe-registry.json'
import fieldworkRegistry from '../.mfe/mfe-registry.json'
import { expect, it } from 'vitest'
import { injectUserContext } from '#mfe/user-context/well-inspection'
import { fieldwork as app, wellInspection } from './mfe'

// Canonical contracts come from the same generated registry artifacts deployed by each owner.
const generatedSchema = {
  formatVersion: 1,
  contracts: [...labRegistry.definitions, ...fieldworkRegistry.definitions].flatMap(definition =>
    'userContextContract' in definition ? [definition.userContextContract] : [],
  ),
}
const schema = generatedSchema as NonNullable<MemoryRuntimeOptions['userContext']>['schema']

async function state() {
  const { repository } = createTestUserContextRepository()
  const backend = (owner: string) =>
    createUserContextBackend({
      repository,
      resolveOwner: async () => owner,
      authorize: async () => undefined,
    })
  const lab = backend('lab')
  const adapter = backend('well-inspection')
  await lab.write(
    {
      scope: 'test',
      id: 'lab',
      expectedRevision: 0,
      operationId: 'react-selection',
      value: {
        units: 'imperial',
        'well-selection': { wellId: 'well-42', runId: 'run-8', comparisonMode: 'overlay' },
      },
    },
    new AbortController().signal,
  )
  return { schema, scope: 'test', adapter }
}

it('reads Lab without a setter and persists its own inspection brief across mounts', async () => {
  const userContext = await state()
  const mounted = await mountWidget(wellInspection, { userContext })
  expect(mounted.element.textContent).toContain('North Ridge 42')
  expect(mounted.element.textContent).toContain('Inspection depth: 8,038 ft')
  const foreign = runInInjectionContext(mounted.injector, () =>
    injectUserContext('lab', context => context['well-selection']),
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
  const saved = await userContext.adapter.hydrate(
    'test',
    ['lab', 'well-inspection'],
    new AbortController().signal,
  )
  expect(saved[0]?.value).toMatchObject({
    'well-selection': { comparisonMode: 'overlay', runId: 'run-8' },
  })
  expect(saved[1]?.value).toEqual({
    brief: {
      wellId: 'well-42',
      runId: 'run-8',
      text: 'Inspect North Ridge 42 at North Ridge pad, using October survey at 8,038 ft.',
    },
  })
  await mounted.dispose()
  const reopened = await mountWidget(wellInspection, { userContext })
  expect(reopened.element.textContent).toContain(
    'Inspect North Ridge 42 at North Ridge pad, using October survey at 8,038 ft.',
  )
  const clear = [...reopened.element.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    button.textContent?.includes('Clear inspection brief'),
  )!
  clear.click()
  await expect
    .poll(async () => {
      await reopened.whenStable()
      return reopened.element.querySelector('[aria-label="Inspection brief"]')
    })
    .toBeNull()
  await reopened.dispose()
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

it('reports a rejected brief save without displaying uncommitted context', async () => {
  const context = await state()
  const mounted = await mountWidget(wellInspection, {
    userContext: {
      ...context,
      adapter: {
        ...context.adapter,
        write: async () => {
          throw new Error('Brief storage unavailable')
        },
      },
    },
  })
  const prepare = [...mounted.element.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    button.textContent?.includes('Prepare inspection'),
  )!
  prepare.click()
  await expect
    .poll(async () => {
      await mounted.whenStable()
      return mounted.element.querySelector('[role="alert"]')?.textContent
    })
    .toContain('Brief storage unavailable')
  expect(mounted.element.querySelector('[aria-label="Inspection brief"]')).toBeNull()
  await mounted.dispose()
})
