import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buttonVariants } from '@tecton/react/components/button'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ACTION_BUTTON, COPY_BUTTON } from './button-classes.ts'
import { FailurePage, type Failure } from './failure-page.tsx'

const AT = new Date('2026-09-25T20:14:42Z')

describe('FailurePage', () => {
  const previous = globalThis.window
  beforeAll(() => {
    // The page names the path it failed on; the server renderer has no window of its own.
    Object.assign(globalThis, { window: { location: { pathname: '/operations' } } })
  })
  afterAll(() => {
    Object.assign(globalThis, { window: previous })
  })

  const render = (failure: Failure): string =>
    renderToStaticMarkup(createElement(FailurePage, { failure, at: AT }))

  it('says a failed sign-in is a 401, with the reason and the way back in', () => {
    const html = render({
      kind: 'sign-in',
      title: 'We could not sign you in',
      detail: 'No matching state found in storage',
      actionLabel: 'Sign in again',
      onAction: () => undefined,
    })

    expect(html).toContain('data-failure="sign-in"')
    expect(html).toContain('401')
    expect(html).toContain('We could not sign you in')
    expect(html).toContain('No matching state found in storage')
    expect(html).toContain('Sign in again')
    expect(html).toContain('/operations')
    expect(html).toContain('2026-09-25 20:14:42 UTC')
    expect(html).toContain('SIGN-IN FAILED')
  })

  it('tells an unreachable provider and a broken configuration apart', () => {
    const unreachable = render({
      kind: 'unreachable',
      title: 'The sign-in service is unreachable',
      detail: 'Failed to fetch',
      onAction: () => undefined,
    })
    const configuration = render({
      kind: 'configuration',
      title: 'Sign-in is not configured',
      detail: 'OIDC_CLIENT_ID is missing.',
    })

    expect(unreachable).toContain('503')
    expect(unreachable).toContain('Try again')
    expect(configuration).toContain('500')
    expect(configuration).not.toContain('data-failure-action')
  })
})

describe('the failure page’s buttons', () => {
  it('draw exactly as Tecton’s Button does', () => {
    expect(ACTION_BUTTON).toBe(buttonVariants())
    expect(COPY_BUTTON).toBe(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))
  })
})
