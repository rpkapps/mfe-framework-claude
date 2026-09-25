/**
 * An action's shortcut, read by the registry from one host listener: whose keys are live, what a
 * field keeps, and what happens when two registrations want the same keys.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deny, isMfeError, type ActionRegistration } from '@company/mfe-core'

import { createMountContext } from '../mount/mount-context.ts'
import { createMemoryRuntime } from '../testing/memory-runtime.ts'
import type { ActionExecutionResult } from './action-executor.ts'
import {
  ActionRegistry,
  type ActionOwner,
  type ActionRegistryOptions,
  type ShortcutDispatchResult,
} from './action-registry.ts'
import { codesOf, recordingDiagnostics } from '../__tests__/harness.ts'

function action(overrides: Partial<ActionRegistration> = {}): ActionRegistration {
  return { name: 'refresh', label: 'Refresh', execute: () => undefined, ...overrides }
}

function app(definitionId: string, basePath = `/${definitionId}`): ActionOwner {
  return { definitionId, mountToken: `${definitionId}#1`, kind: 'app', basePath }
}

function widget(definitionId: string): ActionOwner {
  return { definitionId, mountToken: `${definitionId}#1`, kind: 'widget', basePath: '' }
}

/** A registry on a page whose pathname the test moves. */
function setup(options: ActionRegistryOptions = {}) {
  const { hub, records } = recordingDiagnostics()
  const page = { pathname: '/' }
  const registry = new ActionRegistry({
    diagnostics: hub,
    readPathname: () => page.pathname,
    ...options,
  })
  return { registry, records, page }
}

/** A keydown the way a browser delivers it, aimed at `target`. */
function keydown(
  registry: ActionRegistry,
  init: KeyboardEventInit & { key: string },
  target: EventTarget = document.body,
): { readonly result: ShortcutDispatchResult; readonly event: KeyboardEvent } {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return { result: registry.handleKeyDown(event), event }
}

function executionOf(result: ShortcutDispatchResult): Promise<ActionExecutionResult> {
  if (result.status !== 'matched') throw new Error(`expected a match, got ${result.status}`)
  return result.execution
}

beforeEach(() => {
  // Pinned, so `mod` is Ctrl whatever machine the suite runs on.
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
  document.body.replaceChildren()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('declaring a shortcut', () => {
  it('publishes the normalized spelling on the entry', () => {
    const { registry } = setup()

    registry.registerHost(action({ shortcut: 'Shift+Mod+K' }))

    expect(registry.getSnapshot()[0]?.shortcut).toBe('mod+shift+k')
  })

  it('leaves the entry without one when none was declared', () => {
    const { registry } = setup()

    registry.registerHost(action())

    expect(registry.getSnapshot()[0]).not.toHaveProperty('shortcut')
  })

  it('rejects a shortcut it cannot read, naming the registration and the problem', () => {
    const { registry } = setup()

    let thrown: unknown
    try {
      registry.register(app('reports'), action({ shortcut: 'mod+shift' }))
    } catch (error) {
      thrown = error
    }

    expect(isMfeError(thrown)).toBe(true)
    if (!isMfeError(thrown)) return
    expect(thrown.code).toBe('action/invalid-registration')
    expect(thrown.message).toContain("reports failed to register action 'refresh'")
    expect(thrown.message).toContain('"mod+shift" is only modifiers')
    expect(registry.size).toBe(0)
  })

  it('rejects an unreadable shortcut arriving through update, and keeps the last good one', () => {
    const { registry } = setup()
    const handle = registry.registerHost(action({ shortcut: 'g r' }))

    expect(() => {
      handle.update(action({ shortcut: 'g+' }))
    }).toThrow(/empty part/)
    expect(registry.getSnapshot()[0]?.shortcut).toBe('g r')
  })

  it('follows an update to the shortcut, and reports only when it changes', () => {
    const { registry, records } = setup()
    const handle = registry.register(widget('orders'), action({ shortcut: 'e' }))
    expect(codesOf(records)).toHaveLength(1)

    handle.update(action({ shortcut: 'e', label: 'Refresh the orders' }))
    handle.update(action({ shortcut: 'e', label: 'Refresh the orders' }))
    expect(codesOf(records)).toHaveLength(1)

    handle.update(action({ shortcut: 'x' }))
    expect(codesOf(records)).toHaveLength(2)
  })
})

describe('reading a key press', () => {
  it('runs a host action and claims the event', async () => {
    const { registry } = setup()
    const execute = vi.fn()
    registry.registerHost(action({ name: 'palette', shortcut: 'mod+k', execute }))

    const { result, event } = keydown(registry, { key: 'k', ctrlKey: true })

    expect(result).toMatchObject({ status: 'matched', actionId: '@host:palette' })
    await expect(executionOf(result)).resolves.toEqual({ status: 'executed', value: undefined })
    expect(execute).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('runs an action no surface lists, because placements do not decide the keys', async () => {
    const { registry } = setup()
    const execute = vi.fn()
    registry.registerHost(action({ shortcut: 'mod+k', placements: [], execute }))

    const { result } = keydown(registry, { key: 'k', ctrlKey: true })

    await expect(executionOf(result)).resolves.toEqual({ status: 'executed', value: undefined })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('reads mod as ⌘ on an Apple platform', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const { registry } = setup()
    registry.registerHost(action({ name: 'palette', shortcut: 'mod+k' }))

    expect(keydown(registry, { key: 'k', ctrlKey: true }).result.status).toBe('unmatched')
    expect(keydown(registry, { key: 'k', metaKey: true }).result.status).toBe('matched')
  })

  it('leaves an unclaimed key alone', () => {
    const { registry } = setup()
    registry.registerHost(action({ shortcut: 'mod+k' }))

    const { result, event } = keydown(registry, { key: 'j', ctrlKey: true })

    expect(result).toEqual({ status: 'unmatched' })
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores an event something else already handled, and a modifier pressed alone', () => {
    const { registry } = setup()
    const execute = vi.fn()
    registry.registerHost(action({ shortcut: 'mod+k', execute }))

    const handled = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })
    handled.preventDefault()

    expect(registry.handleKeyDown(handled)).toEqual({ status: 'unmatched' })
    expect(keydown(registry, { key: 'Control', ctrlKey: true }).result.status).toBe('unmatched')
    expect(execute).not.toHaveBeenCalled()
  })

  it('runs a denied action through the palette’s path, so the denial is announced', async () => {
    const notifyDenial = vi.fn()
    const { registry } = setup({ notifyDenial })
    const execute = vi.fn()
    registry.registerHost(
      action({
        name: 'clear',
        label: 'Clear the canvas',
        shortcut: 'mod+backspace',
        canExecute: () => deny('The canvas is already empty.'),
        execute,
      }),
    )

    const { result, event } = keydown(registry, { key: 'Backspace', ctrlKey: true })

    await expect(executionOf(result)).resolves.toEqual({
      status: 'denied',
      reason: 'The canvas is already empty.',
    })
    expect(execute).not.toHaveBeenCalled()
    expect(notifyDenial).toHaveBeenCalledWith({
      actionId: '@host:clear',
      label: 'Clear the canvas',
      reason: 'The canvas is already empty.',
      caller: 'shortcut',
    })
    // The key was the action's: the browser does not also act on it.
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('sequences', () => {
  it('holds the first key of a sequence and runs on the second', () => {
    const { registry } = setup()
    const execute = vi.fn()
    registry.registerHost(action({ shortcut: 'g r', execute }))

    const first = keydown(registry, { key: 'g' })
    expect(first.result).toEqual({ status: 'pending' })
    expect(first.event.defaultPrevented).toBe(true)
    expect(execute).not.toHaveBeenCalled()

    expect(keydown(registry, { key: 'r' }).result.status).toBe('matched')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('forgets the first key when the second comes too late', () => {
    vi.useFakeTimers()
    const { registry } = setup()
    const execute = vi.fn()
    registry.registerHost(action({ shortcut: 'g r', execute }))

    keydown(registry, { key: 'g' })
    vi.advanceTimersByTime(1001)

    expect(keydown(registry, { key: 'r' }).result).toEqual({ status: 'unmatched' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('starts again from a key that breaks a sequence', () => {
    const { registry } = setup()
    const execute = vi.fn()
    registry.registerHost(action({ shortcut: 'g r', execute }))

    keydown(registry, { key: 'g' })
    expect(keydown(registry, { key: 'g' }).result.status).toBe('pending')
    expect(keydown(registry, { key: 'r' }).result.status).toBe('matched')
    expect(execute).toHaveBeenCalledOnce()
  })
})

describe('keys typed into a field', () => {
  let input: HTMLInputElement
  let option: HTMLElement

  beforeEach(() => {
    input = document.createElement('input')
    option = document.createElement('div')
    option.setAttribute('role', 'option')
    document.body.append(input, option)
  })

  function harness() {
    const { registry } = setup()
    const onRegistry = vi.fn()
    const onHelp = vi.fn()
    const onPalette = vi.fn()
    registry.registerHost(action({ name: 'registry', shortcut: 'g r', execute: onRegistry }))
    registry.registerHost(action({ name: 'help', shortcut: '?', execute: onHelp }))
    registry.registerHost(action({ name: 'palette', shortcut: 'mod+k', execute: onPalette }))
    return { registry, onRegistry, onHelp, onPalette }
  }

  it('keeps an unmodified key typed straight into a field', () => {
    const { registry, onHelp } = harness()
    input.focus()

    const { result, event } = keydown(registry, { key: '?', shiftKey: true }, input)

    expect(result.status).toBe('unmatched')
    expect(event.defaultPrevented).toBe(false)
    expect(onHelp).not.toHaveBeenCalled()
  })

  it.each([
    ['a textarea', () => document.createElement('textarea')],
    ['a select', () => document.createElement('select')],
    [
      'a contenteditable element',
      () => {
        const element = document.createElement('div')
        element.contentEditable = 'true'
        // jsdom does not derive this from the attribute.
        Object.defineProperty(element, 'isContentEditable', { value: true })
        return element
      },
    ],
  ])('keeps it in %s as well', (_label, create) => {
    const { registry, onHelp } = harness()
    const field = create()
    document.body.append(field)

    expect(keydown(registry, { key: '?' }, field).result.status).toBe('unmatched')
    expect(onHelp).not.toHaveBeenCalled()
  })

  /**
   * React Aria's Autocomplete re-dispatches the field's keydown onto the option it has virtually
   * focused, and cancels the original when the copy is default-prevented; DOM focus stays put.
   */
  it('keeps a letter re-dispatched from a focused field, and does not start a sequence with it', () => {
    const { registry, onRegistry } = harness()
    input.focus()

    const g = keydown(registry, { key: 'g' }, option)
    expect(g.result.status).toBe('unmatched')
    expect(g.event.defaultPrevented).toBe(false)

    const r = keydown(registry, { key: 'r' }, option)
    expect(r.result.status).toBe('unmatched')
    expect(r.event.defaultPrevented).toBe(false)
    expect(onRegistry).not.toHaveBeenCalled()
  })

  it('keeps a symbol re-dispatched from a focused field', () => {
    const { registry, onHelp } = harness()
    input.focus()

    expect(keydown(registry, { key: '?', shiftKey: true }, option).result.status).toBe('unmatched')
    expect(onHelp).not.toHaveBeenCalled()
  })

  it('still runs a chord with a modifier from inside a field', () => {
    const { registry, onPalette } = harness()
    input.focus()

    expect(keydown(registry, { key: 'k', ctrlKey: true }, option).result.status).toBe('matched')
    expect(keydown(registry, { key: 'k', ctrlKey: true }, input).result.status).toBe('matched')
    expect(onPalette).toHaveBeenCalledTimes(2)
  })

  it('runs an unmodified shortcut when no field has focus', () => {
    const { registry, onRegistry, onHelp } = harness()

    keydown(registry, { key: 'g' }, option)
    expect(keydown(registry, { key: 'r' }, option).result.status).toBe('matched')
    expect(keydown(registry, { key: '?', shiftKey: true }).result.status).toBe('matched')
    expect(onRegistry).toHaveBeenCalledOnce()
    expect(onHelp).toHaveBeenCalledOnce()
  })
})

describe('whose shortcuts are live', () => {
  it('runs an App’s shortcut only while the page is inside its boundary', () => {
    const { registry, page } = setup()
    const reports = vi.fn()
    const operations = vi.fn()
    registry.register(app('reports'), action({ shortcut: 'mod+e', execute: reports }))
    registry.register(app('operations'), action({ shortcut: 'mod+e', execute: operations }))

    page.pathname = '/reports/accounts/42'
    keydown(registry, { key: 'e', ctrlKey: true })
    page.pathname = '/operations'
    keydown(registry, { key: 'e', ctrlKey: true })
    page.pathname = '/'
    const outside = keydown(registry, { key: 'e', ctrlKey: true })

    expect(reports).toHaveBeenCalledOnce()
    expect(operations).toHaveBeenCalledOnce()
    expect(outside.result.status).toBe('unmatched')
    expect(outside.event.defaultPrevented).toBe(false)
  })

  it('does not read a boundary as a mere prefix of the path', () => {
    const { registry, page } = setup()
    const execute = vi.fn()
    registry.register(app('reports'), action({ shortcut: 'mod+e', execute }))

    page.pathname = '/reports-archive'
    keydown(registry, { key: 'e', ctrlKey: true })

    expect(execute).not.toHaveBeenCalled()
  })

  it('runs the host page’s shortcuts wherever the page is', () => {
    const { registry, page } = setup()
    const execute = vi.fn()
    registry.registerHost(action({ shortcut: '?', execute }))

    page.pathname = '/reports/accounts'
    keydown(registry, { key: '?' })

    expect(execute).toHaveBeenCalledOnce()
  })

  it('runs both of two nested Apps’ shortcuts while the page is inside the inner one', () => {
    const { registry, page } = setup()
    const outer = vi.fn()
    const inner = vi.fn()
    registry.register(app('workbench'), action({ shortcut: 'mod+o', execute: outer }))
    registry.register(
      app('counter', '/workbench/counter'),
      action({ shortcut: 'mod+i', execute: inner }),
    )

    page.pathname = '/workbench/counter/3'
    keydown(registry, { key: 'o', ctrlKey: true })
    keydown(registry, { key: 'i', ctrlKey: true })
    page.pathname = '/workbench'
    keydown(registry, { key: 'i', ctrlKey: true })

    expect(outer).toHaveBeenCalledOnce()
    expect(inner).toHaveBeenCalledOnce()
  })

  it('refuses a Widget’s shortcut, keeps its action, and says why', () => {
    const { registry, records, page } = setup()
    const execute = vi.fn()
    page.pathname = '/'

    registry.register(widget('orders'), action({ shortcut: 'mod+e', execute }))
    keydown(registry, { key: 'e', ctrlKey: true })

    expect(registry.getSnapshot()).toMatchObject([{ id: 'orders:refresh' }])
    expect(registry.getSnapshot()[0]).not.toHaveProperty('shortcut')
    expect(execute).not.toHaveBeenCalled()
    expect(records).toHaveLength(1)
    expect(records[0]?.severity).toBe('warning')
    expect(records[0]?.error.message).toContain('a shortcut from a Widget')
    expect(records[0]?.error.code).toBe('action/shortcut-refused')
  })

  it('stops reading a mount’s shortcuts when the mount is disposed', async () => {
    const memory = createMemoryRuntime({ initialEntries: ['/reports'] })
    const { runtime } = memory
    const mount = createMountContext({
      runtime,
      definitionId: 'reports',
      kind: 'app',
      basePath: '/reports',
    })
    const execute = vi.fn()
    runtime.actions.register(mount.context, action({ shortcut: 'mod+e', execute }))
    expect(keydown(runtime.actions, { key: 'e', ctrlKey: true }).result.status).toBe('matched')

    await mount.dispose()

    expect(runtime.actions.getSnapshot()).toEqual([])
    expect(keydown(runtime.actions, { key: 'e', ctrlKey: true }).result.status).toBe('unmatched')
    expect(execute).toHaveBeenCalledOnce()
    memory.dispose()
  })
})

describe('the host page’s reserved keys', () => {
  it('refuses a container shortcut the host page uses, and runs the host’s', () => {
    const { registry, records, page } = setup()
    const host = vi.fn()
    const container = vi.fn()
    registry.registerHost(action({ name: 'registry', shortcut: 'g r', execute: host }))

    registry.register(app('reports'), action({ shortcut: 'g r', execute: container }))
    page.pathname = '/reports'
    keydown(registry, { key: 'g' })
    keydown(registry, { key: 'r' })

    expect(host).toHaveBeenCalledOnce()
    expect(container).not.toHaveBeenCalled()
    expect(registry.getSnapshot().find(entry => entry.id === 'reports:refresh')).not.toHaveProperty(
      'shortcut',
    )
    expect(records[0]?.error.message).toContain("the host page’s '@host:registry' (g r) uses them")
    expect(records[0]?.error.code).toBe('action/shortcut-refused')
  })

  it('refuses a container shortcut that begins one of the host page’s', () => {
    const { registry, records, page } = setup()
    const host = vi.fn()
    registry.registerHost(action({ name: 'registry', shortcut: 'g r', execute: host }))

    registry.register(app('reports'), action({ shortcut: 'g' }))
    page.pathname = '/reports'
    keydown(registry, { key: 'g' })
    keydown(registry, { key: 'r' })

    expect(host).toHaveBeenCalledOnce()
    expect(records).toHaveLength(1)
  })

  it('takes the keys back from a container when the host page claims them later, and frees them', () => {
    const { registry, records, page } = setup()
    const container = vi.fn()
    page.pathname = '/reports'
    registry.register(app('reports'), action({ shortcut: 'mod+e', execute: container }))
    expect(registry.getSnapshot()[0]?.shortcut).toBe('mod+e')

    const host = registry.registerHost(action({ name: 'export', shortcut: 'ctrl+e' }))
    expect(registry.getSnapshot()[0]).not.toHaveProperty('shortcut')
    expect(records).toHaveLength(1)

    host.remove()
    expect(registry.getSnapshot()[0]?.shortcut).toBe('mod+e')
    keydown(registry, { key: 'e', ctrlKey: true })
    expect(container).toHaveBeenCalledOnce()
  })
})

describe('two registrations with the same keys', () => {
  it('runs neither when one mount claims the same keys twice, and reports it once', () => {
    const { registry, records, page } = setup()
    const refresh = vi.fn()
    const reload = vi.fn()
    page.pathname = '/reports'
    registry.register(
      app('reports'),
      action({ name: 'refresh', shortcut: 'mod+r', execute: refresh }),
    )
    registry.register(
      app('reports'),
      action({ name: 'reload', shortcut: 'ctrl+r', execute: reload }),
    )

    const { result, event } = keydown(registry, { key: 'r', ctrlKey: true })

    expect(result).toEqual({
      status: 'ambiguous',
      actionIds: ['reports:refresh', 'reports:reload'],
    })
    expect(refresh).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(records).toHaveLength(1)
    expect(records[0]?.error.message).toContain("'reports:refresh' (mod+r) already claims them")
    expect(records[0]?.error.code).toBe('action/shortcut-refused')
  })

  it('runs neither of two host shortcuts where one begins the other', () => {
    const { registry, records } = setup()
    const go = vi.fn()
    registry.registerHost(action({ name: 'go', shortcut: 'g', execute: go }))
    registry.registerHost(action({ name: 'registry', shortcut: 'g r' }))

    expect(keydown(registry, { key: 'g' }).result.status).toBe('ambiguous')
    expect(go).not.toHaveBeenCalled()
    expect(records).toHaveLength(1)
  })

  it('reports nested Apps that claim the same keys', () => {
    const { registry, records } = setup()
    registry.register(app('workbench'), action({ shortcut: 'mod+s' }))
    registry.register(app('counter', '/workbench/counter'), action({ shortcut: 'mod+s' }))

    expect(records).toHaveLength(1)
  })

  it('lets two Apps that are never live together use the same keys', () => {
    const { registry, records } = setup()
    registry.register(app('reports'), action({ shortcut: 'mod+s' }))
    registry.register(app('operations'), action({ shortcut: 'mod+s' }))

    expect(records).toEqual([])
  })

  it('runs the one left once the other goes away', () => {
    const { registry, page } = setup()
    const refresh = vi.fn()
    page.pathname = '/reports'
    registry.register(
      app('reports'),
      action({ name: 'refresh', shortcut: 'mod+r', execute: refresh }),
    )
    const reload = registry.register(app('reports'), action({ name: 'reload', shortcut: 'mod+r' }))

    reload.remove()
    keydown(registry, { key: 'r', ctrlKey: true })

    expect(refresh).toHaveBeenCalledOnce()
  })
})
