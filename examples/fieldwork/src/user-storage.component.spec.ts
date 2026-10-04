import { runInInjectionContext } from '@angular/core'
import { Router } from '@angular/router'
import { injectStoredState } from '@company/mfe-angular'
import { createMemoryUserStorage, mountApp, mountWidget } from '@company/mfe-angular/testing'
import { expect, it } from 'vitest'

import { fieldwork as app, wellInspection } from './mfe'
import { labSelection } from './storage'

const text = 'Inspect North Ridge 42 at North Ridge pad, using October survey at 8,038 ft.'

/** What the Lab saved: the user's units and selection, owned by `lab`. */
function savedByLab() {
  return createMemoryUserStorage({
    lab: {
      units: { v: 1, d: 'imperial', revision: 1 },
      'well-selection': {
        v: 1,
        d: { wellId: 'well-42', runId: 'run-8', comparisonMode: 'overlay' },
        revision: 1,
      },
    },
  })
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(candidate =>
    candidate.textContent?.includes(label),
  )
  if (found === undefined) throw new Error(`No ${label} button`)
  return found
}

it('reads the Lab without a setter and saves its own inspection brief across mounts', async () => {
  const userStorage = savedByLab()
  const mounted = await mountWidget(wellInspection, { userStorage })
  expect(mounted.element.textContent).toContain('North Ridge 42')
  expect(mounted.element.textContent).toContain('Inspection depth: 8,038 ft')
  const foreign = runInInjectionContext(mounted.injector, () => injectStoredState(labSelection))
  expect(foreign).not.toHaveProperty('set')
  expect(foreign.value()?.comparisonMode).toBe('overlay')

  button(mounted.element, 'Prepare inspection').click()
  await expect
    .poll(async () => {
      await mounted.whenStable()
      return mounted.element.textContent
    })
    .toContain(text)
  const saved = userStorage.snapshot()
  expect(saved['lab']?.['well-selection']?.d).toMatchObject({ runId: 'run-8' })
  expect(saved['well-inspection']?.['brief']?.d).toEqual({
    wellId: 'well-42',
    runId: 'run-8',
    text,
  })
  await mounted.dispose()

  const reopened = await mountWidget(wellInspection, { userStorage })
  expect(reopened.element.textContent).toContain(text)
  button(reopened.element, 'Clear inspection brief').click()
  await expect
    .poll(async () => {
      await reopened.whenStable()
      return reopened.element.querySelector('[aria-label="Inspection brief"]')
    })
    .toBeNull()
  expect(userStorage.snapshot()['well-inspection']?.['brief']?.d).toBeNull()
  await reopened.dispose()
})

it('resolves the Lab’s saved selection before the Fieldwork route renders', async () => {
  const mounted = await mountApp(app, {
    basePath: '/fieldwork',
    initialEntries: ['/fieldwork/user-storage'],
    definitions: [wellInspection],
    userStorage: savedByLab(),
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

it('reports a rejected brief save and rolls the brief back', async () => {
  const userStorage = savedByLab()
  const mounted = await mountWidget(wellInspection, {
    userStorage: {
      ...userStorage,
      save: async () => {
        throw new Error('Brief storage unavailable')
      },
    },
  })
  button(mounted.element, 'Prepare inspection').click()
  await expect
    .poll(async () => {
      await mounted.whenStable()
      return mounted.element.querySelector('[role="alert"]')?.textContent
    })
    .toContain('Brief storage unavailable')
  expect(mounted.element.querySelector('[aria-label="Inspection brief"]')).toBeNull()
  await mounted.dispose()
})
