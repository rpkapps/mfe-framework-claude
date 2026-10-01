import {
  mountApp,
  createTestSharedStateRepository,
  createSharedStateBackend,
} from '@company/mfe-angular/testing'
import { schema } from '@example/shared-state-contracts/schema'
import { expect, it } from 'vitest'

import app from './mfe'

function state() {
  const repository = createTestSharedStateRepository().repository
  return {
    schema,
    scope: 'test',
    adapter: createSharedStateBackend({ schema, repository, authorize: async () => undefined }),
  }
}

// A component test with explicit fixtures: no shell process, no live credentials, no federation.
// vitest.setup.ts disposes every mount after each test.
it('reads the signed-in user from shell state', async () => {
  const mounted = await mountApp(app, {
    shellState: { user: { id: 'u-1', name: 'Ada Lovelace' } },
    sharedState: state(),
  })

  expect(mounted.element.textContent).toContain('Ada Lovelace')
})

it('renders its PrimeNG controls inside the mount', async () => {
  const mounted = await mountApp(app, { sharedState: state() })

  expect(mounted.element.querySelector('p-select')).not.toBeNull()
  expect(mounted.element.querySelector('p-button button')).not.toBeNull()
})

it('declares no design tokens of its own, and reads the ones the host declares', async () => {
  await mountApp(app, { sharedState: state() })

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
