// @vitest-environment jsdom

/**
 * The forwarding is what is reproduced here: React Aria re-dispatches a palette input's keydown
 * onto the option it has virtually focused, so the registry is handed an unmodified letter whose
 * target is not a field, while DOM focus is still in the field.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createShellShortcutRegistry } from './shortcuts.ts'

/** The copy React Aria makes: the same key, re-aimed at an option. */
function keydown(init: KeyboardEventInit & { key: string }, target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('the shell shortcut registry', () => {
  let input: HTMLInputElement
  let option: HTMLElement

  beforeEach(() => {
    // Pinned, so `mod` is Ctrl whatever machine the suite runs on.
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    document.body.replaceChildren()
    input = document.createElement('input')
    option = document.createElement('div')
    option.setAttribute('role', 'option')
    document.body.append(input, option)
  })

  function harness() {
    const registry = createShellShortcutRegistry()
    const onRegistry = vi.fn()
    const onHelp = vi.fn()
    const onPalette = vi.fn()
    registry.register([
      { id: 'shell.registry', keys: 'g r', label: 'Open the registry', onAction: onRegistry },
      { id: 'shell.help', keys: '?', label: 'Help', onAction: onHelp },
      { id: 'shell.palette', keys: 'mod+k', label: 'Search or jump to…', onAction: onPalette },
    ])
    return { registry, onRegistry, onHelp, onPalette }
  }

  it('lets a letter through when the field it was typed into still has focus', () => {
    const { registry, onRegistry } = harness()
    input.focus()

    const g = keydown({ key: 'g' }, option)
    expect(registry.handleKeyDown(g)).toBe(false)
    // Prevented here, React Aria would cancel the original and nothing would be typed.
    expect(g.defaultPrevented).toBe(false)

    // Nor was `g` buffered as a prefix: the `r` after it is a letter, not the rest of `g r`.
    const r = keydown({ key: 'r' }, option)
    expect(registry.handleKeyDown(r)).toBe(false)
    expect(r.defaultPrevented).toBe(false)
    expect(onRegistry).not.toHaveBeenCalled()
  })

  it('lets a symbol through the same way', () => {
    const { registry, onHelp } = harness()
    input.focus()

    const question = keydown({ key: '?', shiftKey: true }, option)
    expect(registry.handleKeyDown(question)).toBe(false)
    expect(question.defaultPrevented).toBe(false)
    expect(onHelp).not.toHaveBeenCalled()
  })

  it('still fires a chord with a modifier from inside the palette', () => {
    const { registry, onPalette } = harness()
    input.focus()

    const k = keydown({ key: 'k', ctrlKey: true }, option)
    expect(registry.handleKeyDown(k)).toBe(true)
    expect(onPalette).toHaveBeenCalledOnce()
  })

  it('leaves an unmodified shortcut working when no field has focus', () => {
    const { registry, onRegistry, onHelp } = harness()

    expect(registry.handleKeyDown(keydown({ key: 'g' }, option))).toBe(true)
    expect(registry.handleKeyDown(keydown({ key: 'r' }, option))).toBe(true)
    expect(onRegistry).toHaveBeenCalledOnce()

    expect(registry.handleKeyDown(keydown({ key: '?', shiftKey: true }, document.body))).toBe(true)
    expect(onHelp).toHaveBeenCalledOnce()
  })

  it('keeps the registry’s own suppression for a key typed straight into a field', () => {
    const { registry, onHelp } = harness()
    input.focus()

    expect(registry.handleKeyDown(keydown({ key: '?', shiftKey: true }, input))).toBe(false)
    expect(onHelp).not.toHaveBeenCalled()
  })
})
