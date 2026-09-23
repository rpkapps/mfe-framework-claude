import { describe, expect, it } from 'vitest'

import {
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
