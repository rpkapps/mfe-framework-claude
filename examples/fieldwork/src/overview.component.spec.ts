import {
  mountApp,
  createTestUserContextRepository,
  createUserContextBackend,
  type MemoryRuntimeOptions,
} from '@company/mfe-angular/testing'
import labRegistry from '../../lab/.mfe/mfe-registry.json'
import fieldworkRegistry from '../.mfe/mfe-registry.json'
import { expect, it } from 'vitest'

import { fieldwork as app } from './mfe'

// Canonical contracts come from the same generated registry artifacts deployed by each owner.
const generatedSchema = {
  formatVersion: 1,
  contracts: [...labRegistry.definitions, ...fieldworkRegistry.definitions].flatMap(definition =>
    'userContextContract' in definition ? [definition.userContextContract] : [],
  ),
}
const schema = generatedSchema as NonNullable<MemoryRuntimeOptions['userContext']>['schema']

function state() {
  const repository = createTestUserContextRepository().repository
  return {
    schema,
    scope: 'test',
    adapter: createUserContextBackend({
      repository,
      resolveOwner: async () => 'fieldwork',
      authorize: async () => undefined,
    }),
  }
}

// A component test with explicit fixtures: no shell process, no live credentials, no federation.
// vitest.setup.ts disposes every mount after each test.
it('reads the signed-in user from shell state', async () => {
  const mounted = await mountApp(app, {
    shellState: { user: { id: 'u-1', name: 'Ada Lovelace' } },
    userContext: state(),
  })

  expect(mounted.element.textContent).toContain('Ada Lovelace')
})

it('renders its PrimeNG controls inside the mount', async () => {
  const mounted = await mountApp(app, { userContext: state() })

  expect(mounted.element.querySelector('p-select')).not.toBeNull()
  expect(mounted.element.querySelector('p-button button')).not.toBeNull()
})

it('declares no design tokens of its own, and reads the ones the host declares', async () => {
  await mountApp(app, { userContext: state() })

  // With no preset PrimeNG writes its components' rules and none of the variables they read: the
  // host declares those for the whole page, so they follow the theme class on <html>.
  const styles = [
    ...document.head.querySelectorAll<HTMLStyleElement>('style[data-primeng-style-id]'),
  ]
  const declared = styles.filter(style => /--p-[\w-]+\s*:/.test(style.textContent ?? ''))
  const button =
    document.head.querySelector('style[data-primeng-style-id="button-style"]')?.textContent ?? ''

  expect(styles.length).toBeGreaterThan(0)
  expect(declared.map(style => style.dataset['primengStyleId'])).toEqual([])
  expect(button).toContain('var(--p-button-primary-background)')
})
