import { mountApp } from '@company/mfe-angular/testing'
import { expect, it } from 'vitest'

import app from './mfe'
import { PRIMENG_DARK_CLASS } from './primeng'

// A component test with explicit fixtures: no shell process, no live credentials, no federation.
// vitest.setup.ts disposes every mount after each test.
it('reads the signed-in user from shell state', async () => {
  const mounted = await mountApp(app, {
    shellState: { user: { id: 'u-1', name: 'Ada Lovelace' } },
  })

  expect(mounted.element.textContent).toContain('Ada Lovelace')
})

it('renders its PrimeNG controls inside the mount', async () => {
  const mounted = await mountApp(app)

  expect(mounted.element.querySelector('p-select')).not.toBeNull()
  expect(mounted.element.querySelector('p-button button')).not.toBeNull()
})

it('declares the select’s variables again for the dark class, so they resolve on this mount', async () => {
  await mountApp(app)

  // PrimeNG writes each component's variables into the head once one renders. A reference left
  // only in the light block would be resolved at :root and stay light under a dark scope root.
  const css =
    document.head.querySelector('style[data-primeng-style-id="select-variables"]')?.textContent ??
    ''
  const dark = css.slice(css.indexOf(`.${PRIMENG_DARK_CLASS}{`))
  expect(dark).toContain('--p-select-background:var(--p-form-field-background)')
})
