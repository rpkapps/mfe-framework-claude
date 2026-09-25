// @vitest-environment jsdom

/**
 * The shell's keys are its own actions' shortcuts, read by the runtime from the one listener the
 * shell installs; nothing of the design system's shortcut registry is left. These press the keys
 * the shell has always had and check they still do what they did, and that a mounted App cannot
 * take one of them.
 */

import { HOST_SCOPE } from '@company/mfe-react'
import { createMemoryRuntime, type MemoryRuntime } from '@company/mfe-react/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_LAYOUT } from './dashboard/layout-store.ts'
import { shellActions } from './shell-actions.ts'
import { shellUi } from './ui-store.ts'

const opened = vi.hoisted(() => ({ panels: [] as string[] }))

vi.mock('@company/mfe-devtools', () => ({
  devtools: {
    open: (panel: string) => {
      opened.panels.push(panel)
    },
  },
}))

let memory: MemoryRuntime

beforeEach(() => {
  // Pinned, so `mod` is Ctrl whatever machine the suite runs on.
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
  opened.panels = []
  shellUi.close()
  document.body.replaceChildren()
  memory = createMemoryRuntime({ initialEntries: ['/'] })
})

afterEach(() => {
  memory.dispose()
  vi.restoreAllMocks()
})

function registerShell(goToDashboard = vi.fn()) {
  const { runtime } = memory
  for (const registration of shellActions({
    runtime,
    theme: 'dark',
    layout: EMPTY_LAYOUT,
    setLayout: () => undefined,
    goToDashboard,
  })) {
    runtime.actions.registerHost(registration)
  }
  return { goToDashboard }
}

/** Presses one chord as the shell's document listener would receive it. */
function press(init: KeyboardEventInit & { key: string }, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return memory.runtime.actions.handleKeyDown(event)
}

describe('the shell’s keys', () => {
  it('keep the keys they had', () => {
    registerShell()

    const keys = Object.fromEntries(
      memory.runtime.actions.getSnapshot().map(entry => [entry.name, entry.shortcut]),
    )

    expect(keys).toMatchObject({
      palette: 'mod+k',
      help: '?',
      registry: 'g r',
      devtools: 'g d',
      settings: 'g s',
      dashboard: 'g w',
      theme: 'mod+j',
    })
  })

  it('opens and closes the palette, the help sheet and settings', () => {
    registerShell()

    press({ key: 'k', ctrlKey: true })
    expect(shellUi.getSnapshot()).toBe('palette')
    press({ key: 'k', ctrlKey: true })
    expect(shellUi.getSnapshot()).toBeNull()

    press({ key: '?', shiftKey: true })
    expect(shellUi.getSnapshot()).toBe('help')

    press({ key: 'g' })
    press({ key: 's' })
    expect(shellUi.getSnapshot()).toBe('settings')
  })

  it('opens the developer tools, goes to the dashboard and switches the theme', () => {
    const { goToDashboard } = registerShell()

    press({ key: 'g' })
    press({ key: 'r' })
    press({ key: 'g' })
    press({ key: 'd' })
    press({ key: 'g' })
    press({ key: 'w' })
    press({ key: 'j', ctrlKey: true })

    expect(opened.panels).toEqual(['registry', 'overrides'])
    expect(goToDashboard).toHaveBeenCalledOnce()
    expect(memory.runtime.shellState.getSnapshot().theme).toBe('light')
  })

  it('leaves a letter typed into the palette’s field in the field', () => {
    registerShell()
    const input = document.createElement('input')
    const option = document.createElement('div')
    document.body.append(input, option)
    input.focus()

    expect(press({ key: 'g' }, option).status).toBe('unmatched')
    expect(press({ key: 's' }, option).status).toBe('unmatched')
    expect(shellUi.getSnapshot()).toBeNull()

    // A chord with a modifier still closes the palette it is typed into.
    shellUi.show('palette')
    press({ key: 'k', ctrlKey: true }, option)
    expect(shellUi.getSnapshot()).toBeNull()
  })

  it('keep the palette and the dashboard out of the palette’s own list', () => {
    registerShell()

    const listed = memory.runtime.actions
      .getSnapshot()
      .filter(entry => entry.placements.includes('palette'))
      .map(entry => entry.name)

    expect(listed).not.toContain('palette')
    expect(listed).not.toContain('dashboard')
    expect(listed).toContain('settings')
  })

  it('are reserved: a mounted App asking for one is refused, and the shell’s still runs', () => {
    registerShell()
    memory.navigation.push('/reports')
    const execute = vi.fn()

    memory.runtime.actions.register(
      { definitionId: 'reports', mountToken: 'reports#1', kind: 'app', basePath: '/reports' },
      { name: 'search', label: 'Search the reports', shortcut: 'mod+k', execute },
    )
    press({ key: 'k', ctrlKey: true })

    expect(execute).not.toHaveBeenCalled()
    expect(shellUi.getSnapshot()).toBe('palette')
    expect(
      memory.runtime.actions.getSnapshot().find(entry => entry.definitionId !== HOST_SCOPE),
    ).not.toHaveProperty('shortcut')
    expect(memory.diagnostics.map(record => record.error.message).join('\n')).toContain(
      "the host page’s '@host:palette' (mod+k) uses them",
    )
  })
})
