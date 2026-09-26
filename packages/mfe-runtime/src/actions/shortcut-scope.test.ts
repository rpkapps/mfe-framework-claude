import { describe, expect, it, vi } from 'vitest'

import {
  canCoexist,
  HOST_PAGE_SCOPE,
  isLive,
  mountShortcutScope,
  type ShortcutScope,
} from './shortcut-scope.ts'

const widget = mountShortcutScope('widget', '')

function app(basePath: string): ShortcutScope {
  return mountShortcutScope('app', basePath)
}

describe('isLive', () => {
  it('keeps the host page’s scope live without asking where the page is', () => {
    const pathname = vi.fn(() => '/reports')

    expect(isLive(HOST_PAGE_SCOPE, pathname)).toBe(true)
    expect(pathname).not.toHaveBeenCalled()
  })

  it('never makes a Widget’s scope live, and does not ask where the page is', () => {
    const pathname = vi.fn(() => '/')

    expect(isLive(widget, pathname)).toBe(false)
    expect(pathname).not.toHaveBeenCalled()
  })

  it.each([
    ['/reports', '/reports', true],
    ['/reports', '/reports/accounts/42', true],
    ['/reports/', '/reports/accounts', true],
    ['/reports', '/reports-archive', false],
    ['/reports', '/', false],
    ['', '/anything', true],
    ['/', '/anything', true],
  ])('reads an App at %j as live at %j: %s', (basePath, pathname, live) => {
    expect(isLive(app(basePath), () => pathname)).toBe(live)
  })

  it('keeps an App’s scope dead when nothing says where the page is', () => {
    expect(isLive(app('/reports'), () => undefined)).toBe(false)
  })
})

describe('canCoexist', () => {
  it.each([
    ['two in the host page', HOST_PAGE_SCOPE, HOST_PAGE_SCOPE, true],
    ['the host page and an App, which it outranks', HOST_PAGE_SCOPE, app('/reports'), false],
    ['the host page and a Widget', HOST_PAGE_SCOPE, widget, false],
    ['two Widgets', widget, widget, false],
    ['a Widget and an App', widget, app('/reports'), false],
    ['one App’s boundary', app('/reports'), app('/reports'), true],
    ['an App nested in another', app('/workbench'), app('/workbench/counter'), true],
    ['an App at the root and any other', app('/'), app('/reports'), true],
    ['two Apps at unrelated boundaries', app('/reports'), app('/operations'), false],
    [
      'a boundary that is a mere prefix of another',
      app('/reports'),
      app('/reports-archive'),
      false,
    ],
  ])('answers for %s', (_label, a, b, expected) => {
    expect(canCoexist(a, b)).toBe(expected)
    expect(canCoexist(b, a)).toBe(expected)
  })
})
