import { describe, expect, it } from 'vitest'

import {
  chordFromEvent,
  matchSequence,
  parseShortcut,
  shortcutsOverlap,
  type ParsedShortcut,
  type PressedChord,
} from './shortcut.ts'

function parsed(source: string): ParsedShortcut {
  const result = parseShortcut(source)
  if (!result.ok) throw new Error(`expected ${JSON.stringify(source)} to parse: ${result.problem}`)
  return result.shortcut
}

function press(key: string, held: Partial<Omit<PressedChord, 'key'>> = {}): PressedChord {
  return { key, ctrl: false, alt: false, shift: false, meta: false, ...held }
}

describe('parseShortcut', () => {
  it.each([
    ['mod+k', 'mod+k'],
    ['Mod+K', 'mod+k'],
    ['shift+mod+k', 'mod+shift+k'],
    ['cmd+option+s', 'alt+meta+s'],
    ['control+enter', 'ctrl+enter'],
    ['?', '?'],
    ['g r', 'g r'],
    ['  g   r  ', 'g r'],
    ['esc', 'escape'],
    ['up', 'arrowup'],
    ['mod+plus', 'mod+plus'],
    ['mod++', 'mod+plus'],
    ['+', 'plus'],
    ['alt+F12', 'alt+f12'],
    ['ctrl+space', 'ctrl+space'],
  ])('reads %j as %j', (source, normalized) => {
    expect(parsed(source).source).toBe(normalized)
  })

  it('keeps mod unresolved, so one registration serves every platform', () => {
    expect(parsed('mod+s').chords).toEqual([
      { key: 's', mod: true, ctrl: false, alt: false, shift: false, meta: false },
    ])
  })

  it.each([
    ['an empty shortcut', '   ', /empty/],
    ['modifiers alone', 'mod+shift', /only modifiers/],
    ['two keys in one chord', 'a+b', /two keys/],
    ['a repeated modifier', 'shift+shift+a', /names shift twice/],
    ['an empty part', 'mod++k', /empty part/],
    ['a trailing +', 'mod+', /empty part/],
    ['an unknown key name', 'mod+escp', /neither a single character nor a key name/],
    ['mod beside ctrl', 'mod+ctrl+k', /combines mod with ctrl/],
    ['mod beside meta', 'mod+meta+k', /combines mod with meta/],
  ])('rejects %s', (_label, source, problem) => {
    const result = parseShortcut(source)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem).toMatch(problem)
  })
})

describe('matchSequence', () => {
  const candidates = [
    { shortcut: parsed('mod+k'), target: 'palette' },
    { shortcut: parsed('g r'), target: 'registry' },
    { shortcut: parsed('?'), target: 'help' },
  ]

  it('reads mod as Ctrl away from Apple platforms', () => {
    expect(matchSequence([press('k', { ctrl: true })], candidates, false)).toEqual({
      kind: 'complete',
      target: 'palette',
    })
    expect(matchSequence([press('k', { meta: true })], candidates, false)).toEqual({
      kind: 'none',
    })
  })

  it('reads mod as ⌘ on Apple platforms', () => {
    expect(matchSequence([press('k', { meta: true })], candidates, true)).toEqual({
      kind: 'complete',
      target: 'palette',
    })
    expect(matchSequence([press('k', { ctrl: true })], candidates, true)).toEqual({ kind: 'none' })
  })

  it('requires the declared modifiers exactly', () => {
    expect(matchSequence([press('k', { ctrl: true, alt: true })], candidates, false)).toEqual({
      kind: 'none',
    })
  })

  it('waits on the first chord of a sequence and completes on the second', () => {
    expect(matchSequence([press('g')], candidates, false)).toEqual({ kind: 'pending' })
    expect(matchSequence([press('g'), press('r')], candidates, false)).toEqual({
      kind: 'complete',
      target: 'registry',
    })
  })

  it('matches a symbol whichever way the layout reaches it', () => {
    expect(matchSequence([press('?', { shift: true })], candidates, false)).toEqual({
      kind: 'complete',
      target: 'help',
    })
    expect(matchSequence([press('?')], candidates, false)).toEqual({
      kind: 'complete',
      target: 'help',
    })
  })

  it('holds a letter to its Shift state', () => {
    const letters = [{ shortcut: parsed('shift+n'), target: 'new' }]

    expect(matchSequence([press('n')], letters, false)).toEqual({ kind: 'none' })
    expect(matchSequence([press('n', { shift: true })], letters, false)).toEqual({
      kind: 'complete',
      target: 'new',
    })
  })

  it('calls two completions ambiguous rather than choosing one', () => {
    const twins = [
      { shortcut: parsed('mod+s'), target: 'save' },
      { shortcut: parsed('ctrl+s'), target: 'store' },
    ]

    expect(matchSequence([press('s', { ctrl: true })], twins, false)).toEqual({
      kind: 'ambiguous',
      targets: ['save', 'store'],
    })
  })

  it('calls a completion ambiguous while another shortcut could still continue it', () => {
    const nested = [
      { shortcut: parsed('g'), target: 'go' },
      { shortcut: parsed('g r'), target: 'registry' },
    ]

    expect(matchSequence([press('g')], nested, false)).toEqual({
      kind: 'ambiguous',
      targets: ['go', 'registry'],
    })
  })
})

describe('chordFromEvent', () => {
  function chordOf(init: KeyboardEventInit): PressedChord | null {
    return chordFromEvent(new KeyboardEvent('keydown', init))
  }

  it('reads the key a Latin layout types', () => {
    expect(chordOf({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true })).toEqual(
      press('k', { ctrl: true, shift: true }),
    )
    expect(chordOf({ key: ' ', code: 'Space' })).toEqual(press('space'))
    expect(chordOf({ key: '+', code: 'Equal', shiftKey: true })).toEqual(
      press('plus', { shift: true }),
    )
    expect(chordOf({ key: 'ArrowUp', code: 'ArrowUp' })).toEqual(press('arrowup'))
  })

  it('reads the physical key where the layout types a letter that is not Latin', () => {
    expect(chordOf({ key: 'л', code: 'KeyK', ctrlKey: true })).toEqual(press('k', { ctrl: true }))
    expect(chordOf({ key: 'Л', code: 'KeyK', shiftKey: true })).toEqual(press('k', { shift: true }))
  })

  it('reads the physical key where Option types another character or a dead key', () => {
    expect(chordOf({ key: '˚', code: 'KeyK', altKey: true })).toEqual(press('k', { alt: true }))
    expect(chordOf({ key: 'Dead', code: 'KeyE', altKey: true })).toEqual(press('e', { alt: true }))
    expect(chordOf({ key: '¡', code: 'Digit1', altKey: true })).toEqual(press('1', { alt: true }))
    expect(chordOf({ key: '@', code: 'KeyL', altKey: true })).toEqual(press('l', { alt: true }))
  })

  it('keeps the symbol AltGr types, which Windows reports as Ctrl with Alt', () => {
    expect(chordOf({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true })).toEqual(
      press('@', { ctrl: true, alt: true }),
    )
  })

  it('keeps a Latin layout’s own reading of a key that has moved', () => {
    // Dvorak's k sits where QWERTY has v; the shortcut means the letter, as the user reads it.
    expect(chordOf({ key: 'k', code: 'KeyV', ctrlKey: true })).toEqual(press('k', { ctrl: true }))
    expect(chordOf({ key: 'ö', code: 'Semicolon' })).toEqual(press('ö'))
  })

  it('reads nothing from a keydown that names no key, as autofill sends', () => {
    expect(chordFromEvent(new Event('keydown') as KeyboardEvent)).toBeNull()
    expect(chordOf({})).toBeNull()
  })

  it('reads nothing from a modifier alone or a key an input method is composing', () => {
    expect(chordOf({ key: 'Control', code: 'ControlLeft', ctrlKey: true })).toBeNull()
    expect(chordOf({ key: 'Process', code: 'KeyK', isComposing: true })).toBeNull()
  })
})

describe('shortcutsOverlap', () => {
  it('finds equal keys however they were spelled', () => {
    expect(shortcutsOverlap(parsed('mod+s'), parsed('ctrl+s'), false)).toBe(true)
    expect(shortcutsOverlap(parsed('mod+s'), parsed('ctrl+s'), true)).toBe(false)
    expect(shortcutsOverlap(parsed('mod+s'), parsed('meta+s'), true)).toBe(true)
  })

  it('finds a shortcut that begins another', () => {
    expect(shortcutsOverlap(parsed('g'), parsed('g r'), false)).toBe(true)
    expect(shortcutsOverlap(parsed('g r'), parsed('g s'), false)).toBe(false)
  })

  it('treats a symbol with and without Shift as the same key', () => {
    expect(shortcutsOverlap(parsed('?'), parsed('shift+?'), false)).toBe(true)
  })
})
