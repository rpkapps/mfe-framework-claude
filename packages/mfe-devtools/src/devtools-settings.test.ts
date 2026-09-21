/**
 * The flag, which is the only thing a page that never opts in pays for. Most of these are about a
 * failure being survivable: a tool that took the page down over a refused storage would be the
 * worse bug.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEVTOOLS_STORAGE_KEY,
  readDevtoolsSettings,
  writeDevtoolsSettings,
  type DevtoolsSettings,
} from './devtools-settings.ts'

/** The page this test is pretending to be: a URL and a storage that works. */
function page(search = '', stored?: string): void {
  if (stored !== undefined) window.localStorage.setItem(DEVTOOLS_STORAGE_KEY, stored)
  window.history.replaceState(null, '', `/${search}`)
}

/** A different browser: nothing carried over from the load before. */
function freshBrowser(): void {
  window.localStorage.clear()
}

/** A storage that refuses this origin, which is what a blocked browser does. */
function blockStorage(): void {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  })
}

const SETTINGS: DevtoolsSettings = {
  on: true,
  side: 'right',
  size: 500,
  open: false,
  tab: 'registry',
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('reading the devtools flag', () => {
  it('is off when nothing was ever set', () => {
    freshBrowser()
    page()

    expect(readDevtoolsSettings().on).toBe(false)
  })

  it('accepts a bare "1", so turning it on by hand is one line in a console', () => {
    freshBrowser()
    page('', '1')

    expect(readDevtoolsSettings().on).toBe(true)
  })

  it('restores the side and size the panel was left at', () => {
    freshBrowser()
    page('', JSON.stringify(SETTINGS))

    expect(readDevtoolsSettings()).toMatchObject({ on: true, side: 'right', size: 500 })
  })

  it('ignores a value that is neither JSON nor a flag word', () => {
    freshBrowser()
    page('', 'maybe?')

    expect(readDevtoolsSettings().on).toBe(false)
  })

  it('falls back to the defaults for a side it does not recognise', () => {
    freshBrowser()
    page('', JSON.stringify({ on: true, side: 'diagonal', size: 'wide' }))

    expect(readDevtoolsSettings()).toMatchObject({ on: true, side: 'bottom', size: 420 })
  })

  it('reads as off when the browser refuses storage, rather than throwing', () => {
    blockStorage()

    expect(() => readDevtoolsSettings()).not.toThrow()
    expect(readDevtoolsSettings().on).toBe(false)
  })
})

describe('the query parameter', () => {
  it('turns the tools on', () => {
    freshBrowser()
    page('?devtools=1')

    expect(readDevtoolsSettings().on).toBe(true)
  })

  it('counts as on with no value at all, which is what somebody typing it means', () => {
    freshBrowser()
    page('?devtools')

    expect(readDevtoolsSettings().on).toBe(true)
  })

  it('persists, so the next load keeps the answer without the parameter', () => {
    freshBrowser()
    page('?devtools=1')
    readDevtoolsSettings()

    // The same browser, a later load, without the parameter.
    page()

    expect(readDevtoolsSettings().on).toBe(true)
  })

  it('turns them off and clears the key, so a forgotten flag has an off switch', () => {
    freshBrowser()
    page('?devtools=0', JSON.stringify(SETTINGS))

    expect(readDevtoolsSettings().on).toBe(false)
    expect(window.localStorage.getItem(DEVTOOLS_STORAGE_KEY)).toBeNull()
  })

  it('keeps the stored side when it only turns the tools on', () => {
    freshBrowser()
    page('?devtools=1', JSON.stringify({ ...SETTINGS, on: false }))

    expect(readDevtoolsSettings()).toMatchObject({ on: true, side: 'right' })
  })
})

describe('writing the devtools settings', () => {
  it('round-trips through the reader', () => {
    freshBrowser()
    page()

    expect(writeDevtoolsSettings(SETTINGS)).toBe(true)
    expect(readDevtoolsSettings()).toMatchObject(SETTINGS)
  })

  it('removes the key when off, leaving no stale side to read back', () => {
    freshBrowser()
    page('', JSON.stringify(SETTINGS))

    writeDevtoolsSettings({ ...SETTINGS, on: false })

    expect(window.localStorage.getItem(DEVTOOLS_STORAGE_KEY)).toBeNull()
  })

  it('reports a blocked store instead of claiming it worked', () => {
    blockStorage()

    expect(writeDevtoolsSettings(SETTINGS)).toBe(false)
  })
})
