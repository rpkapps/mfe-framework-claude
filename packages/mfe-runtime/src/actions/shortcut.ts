/**
 * Keyboard shortcut syntax and matching, with no framework and no design system behind it, so
 * every host and every adapter reads an action's `shortcut` the same way.
 *
 * A chord is modifiers and one key joined by `+` (`mod+k`, `shift+?`, `alt+enter`); a sequence is
 * chords separated by spaces (`g r`). `mod` is kept unresolved until a key event is read, because
 * the same registration means ⌘ on Apple platforms and Ctrl everywhere else.
 */

/** One step of a shortcut as it was declared. */
export interface ShortcutChord {
  /** A lower-cased single character, or a key name from `NAMED_KEYS`. */
  readonly key: string
  readonly mod: boolean
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
}

export interface ParsedShortcut {
  /** The canonical spelling: modifiers in a fixed order, aliases resolved, one space between chords. */
  readonly source: string
  readonly chords: readonly ShortcutChord[]
}

export type ShortcutParseResult =
  | { readonly ok: true; readonly shortcut: ParsedShortcut }
  | { readonly ok: false; readonly problem: string }

/** One key as it was pressed, with the modifiers actually held. */
export interface PressedChord {
  readonly key: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
}

/** How long a sequence waits for its next chord; the design system's registry used the same. */
export const SEQUENCE_TIMEOUT_MS = 1000

const MODIFIER_ALIASES: Readonly<Record<string, keyof Omit<ShortcutChord, 'key'>>> = {
  mod: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
}

/** Written in this order, so two spellings of one chord normalize to the same string. */
const MODIFIER_ORDER = ['mod', 'ctrl', 'alt', 'shift', 'meta'] as const

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  return: 'enter',
  spacebar: 'space',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
}

/** Spelled out rather than typed, because `+` separates a chord and a space separates a sequence. */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  'escape',
  'enter',
  'tab',
  'backspace',
  'delete',
  'insert',
  'home',
  'end',
  'pageup',
  'pagedown',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'space',
  'plus',
  ...Array.from({ length: 24 }, (_, index) => `f${String(index + 1)}`),
])

const MODIFIER_KEYS: ReadonlySet<string> = new Set(['shift', 'control', 'alt', 'meta'])

function parseKey(part: string): string | { readonly problem: string } {
  const lowered = part.toLowerCase()
  const named = KEY_ALIASES[lowered] ?? lowered
  if (NAMED_KEYS.has(named)) return named
  if ([...part].length === 1) return lowered
  return {
    problem: `${JSON.stringify(part)} is neither a single character nor a key name such as escape, enter, space, plus, arrowup or f1`,
  }
}

/** `+` separates the parts, so the plus key itself is `plus`, `+` alone, or a final `++`. */
function splitChord(source: string): readonly string[] {
  if (source === '+') return ['plus']
  if (source.endsWith('++')) return [...source.slice(0, -2).split('+'), 'plus']
  return source.split('+')
}

function parseChord(source: string): ShortcutChord | { readonly problem: string } {
  const flags = { mod: false, ctrl: false, alt: false, shift: false, meta: false }
  let key: string | undefined

  for (const part of splitChord(source)) {
    if (part === '') {
      return { problem: `${JSON.stringify(source)} has an empty part between its + signs` }
    }

    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier !== undefined) {
      if (flags[modifier]) {
        return { problem: `${JSON.stringify(source)} names ${modifier} twice` }
      }
      flags[modifier] = true
      continue
    }

    const parsed = parseKey(part)
    if (typeof parsed !== 'string') return parsed
    if (key !== undefined) {
      return {
        problem: `${JSON.stringify(source)} holds two keys, ${JSON.stringify(key)} and ${JSON.stringify(parsed)}, where a chord holds exactly one`,
      }
    }
    key = parsed
  }

  if (key === undefined) {
    return { problem: `${JSON.stringify(source)} is only modifiers, with no key to press` }
  }
  if (flags.mod && (flags.ctrl || flags.meta)) {
    return {
      problem: `${JSON.stringify(source)} combines mod with ${flags.ctrl ? 'ctrl' : 'meta'}, which is the same key as mod on one platform`,
    }
  }

  return { key, ...flags }
}

function formatChord(chord: ShortcutChord): string {
  return [...MODIFIER_ORDER.filter(modifier => chord[modifier]), chord.key].join('+')
}

/** Never throws: the caller owns the error, because only it can name the registration. */
export function parseShortcut(source: string): ShortcutParseResult {
  const steps = source
    .trim()
    .split(/\s+/)
    .filter(step => step !== '')
  if (steps.length === 0) return { ok: false, problem: 'the shortcut is empty' }

  const chords: ShortcutChord[] = []
  for (const step of steps) {
    const chord = parseChord(step)
    if ('problem' in chord) return { ok: false, problem: chord.problem }
    chords.push(chord)
  }

  return { ok: true, shortcut: { source: chords.map(formatChord).join(' '), chords } }
}

/** `null` for a modifier pressed on its own, which is never a step of a shortcut. */
export function chordFromEvent(event: KeyboardEvent): PressedChord | null {
  const lowered = event.key.toLowerCase()
  if (MODIFIER_KEYS.has(lowered)) return null

  let key = lowered
  if (lowered === ' ') key = 'space'
  else if (lowered === '+') key = 'plus'

  return {
    key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  }
}

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
}

/**
 * A single symbol is typed with or without Shift depending on the layout — `?` is Shift+/ on one
 * keyboard and a key of its own on another — so Shift is not part of what it means.
 */
function ignoresShift(chord: ShortcutChord): boolean {
  return [...chord.key].length === 1 && !/[a-z0-9]/i.test(chord.key)
}

/**
 * `mod` read for the platform, as two plain reads rather than a resolved copy of the chord, because
 * every key press compares every live chord.
 */
function holdsCtrl(chord: ShortcutChord, apple: boolean): boolean {
  return chord.ctrl || (chord.mod && !apple)
}

function holdsMeta(chord: ShortcutChord, apple: boolean): boolean {
  return chord.meta || (chord.mod && apple)
}

function chordMatches(expected: ShortcutChord, pressed: PressedChord, apple: boolean): boolean {
  return (
    expected.key === pressed.key &&
    holdsCtrl(expected, apple) === pressed.ctrl &&
    expected.alt === pressed.alt &&
    holdsMeta(expected, apple) === pressed.meta &&
    (ignoresShift(expected) || expected.shift === pressed.shift)
  )
}

/** Whether one key press on this platform could be read as both chords. */
function chordsCollide(a: ShortcutChord, b: ShortcutChord, apple: boolean): boolean {
  return (
    a.key === b.key &&
    holdsCtrl(a, apple) === holdsCtrl(b, apple) &&
    a.alt === b.alt &&
    holdsMeta(a, apple) === holdsMeta(b, apple) &&
    (ignoresShift(a) || ignoresShift(b) || a.shift === b.shift)
  )
}

/**
 * Two shortcuts overlap when one is the other or begins it: `g` and `g r` cannot both be
 * reachable, because the first fires before the second can finish.
 */
export function shortcutsOverlap(a: ParsedShortcut, b: ParsedShortcut, apple: boolean): boolean {
  const length = Math.min(a.chords.length, b.chords.length)
  for (let index = 0; index < length; index += 1) {
    const left = a.chords[index]
    const right = b.chords[index]
    if (!left || !right || !chordsCollide(left, right, apple)) return false
  }
  return true
}

/** A chord typed into a field is text unless every step of the shortcut holds Ctrl, ⌘ or Alt. */
export function firesInsideFields(shortcut: ParsedShortcut): boolean {
  return shortcut.chords.every(chord => chord.mod || chord.ctrl || chord.alt || chord.meta)
}

export function isEditableElement(node: unknown): boolean {
  if (typeof HTMLElement === 'undefined' || !(node instanceof HTMLElement)) return false
  if (node.isContentEditable) return true
  const tag = node.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** A shortcut, and whatever the caller wants back when it is the one pressed. */
export interface ShortcutCandidate<T> {
  readonly shortcut: ParsedShortcut
  readonly target: T
}

export type SequenceMatch<T> =
  | { readonly kind: 'none' }
  /** The keys so far begin at least one shortcut and complete none. */
  | { readonly kind: 'pending' }
  | { readonly kind: 'complete'; readonly target: T }
  /** More than one shortcut completes, or one completes while another could still go on. */
  | { readonly kind: 'ambiguous'; readonly targets: readonly T[] }

export function matchSequence<T>(
  pressed: readonly PressedChord[],
  candidates: readonly ShortcutCandidate<T>[],
  apple: boolean,
): SequenceMatch<T> {
  const complete: T[] = []
  const continuing: T[] = []

  for (const candidate of candidates) {
    const { chords } = candidate.shortcut
    if (chords.length < pressed.length) continue
    const matches = pressed.every((chord, index) => {
      const expected = chords[index]
      return expected !== undefined && chordMatches(expected, chord, apple)
    })
    if (!matches) continue
    if (chords.length === pressed.length) complete.push(candidate.target)
    else continuing.push(candidate.target)
  }

  const [only] = complete
  if (only !== undefined && complete.length === 1 && continuing.length === 0) {
    return { kind: 'complete', target: only }
  }
  if (complete.length > 0) return { kind: 'ambiguous', targets: [...complete, ...continuing] }
  return continuing.length > 0 ? { kind: 'pending' } : { kind: 'none' }
}
