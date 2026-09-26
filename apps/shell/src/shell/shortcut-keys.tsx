/**
 * Draws an action's `shortcut` as key caps. The design system draws keys (`Kbd`) but no longer
 * reads shortcut syntax, and the runtime reads it without drawing it, so the shell joins the two
 * here. Only a component is exported, so React Refresh can replace this module in place.
 */

import { Fragment, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { parseShortcut, type ShortcutChord } from '@company/mfe-react/host'
import { Kbd, KbdGroup } from '@tecton/react/components/kbd'
import { cn } from 'cn'

const KEY_LABELS: Readonly<Record<string, string>> = {
  escape: 'Esc',
  enter: '↵',
  backspace: '⌫',
  delete: 'Del',
  tab: '⇥',
  space: 'Space',
  plus: '+',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
}

/** The test the runtime reads the platform with, so `mod` is drawn as the key it listens for. */
function isApplePlatform(): boolean {
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
}

const subscribeNever = (): (() => void) => () => undefined

function chordCaps(chord: ShortcutChord, apple: boolean): readonly string[] {
  const caps: string[] = []
  if (chord.ctrl || (chord.mod && !apple)) caps.push(apple ? '⌃' : 'Ctrl')
  if (chord.alt) caps.push(apple ? '⌥' : 'Alt')
  if (chord.shift) caps.push(apple ? '⇧' : 'Shift')
  if (chord.meta || (chord.mod && apple)) caps.push(apple ? '⌘' : 'Win')
  caps.push(KEY_LABELS[chord.key] ?? chord.key.toUpperCase())
  return caps
}

/**
 * `Ctrl + K` or `⌘ + K`, and `G then W` for a sequence. Screen readers get the same as text
 * ("G, then W") while the caps are hidden from them, so no key is read out twice. A spelling the
 * runtime cannot read is drawn as written, because the runtime has already refused to bind it and
 * the caps should not invent a different key.
 */
export function ShortcutKeys({
  keys,
  className,
  ...props
}: ComponentProps<'span'> & { readonly keys: string }): ReactNode {
  // The platform never changes under a page; the server snapshot keeps hydration matching.
  const apple = useSyncExternalStore(subscribeNever, isApplePlatform, () => false)
  const parsed = parseShortcut(keys)
  const chords = parsed.ok ? parsed.shortcut.chords.map(chord => chordCaps(chord, apple)) : [[keys]]
  const spoken = chords.map(chord => chord.join(' + ')).join(', then ')

  return (
    <span
      data-slot="shortcut-keys"
      className={cn('inline-flex items-center', className)}
      {...props}
    >
      <KbdGroup aria-hidden className="gap-1">
        {chords.map((chord, step) => (
          <Fragment key={`${String(step)}-${chord.join('+')}`}>
            {step > 0 && <span className="text-xs text-muted-foreground">then</span>}
            {chord.map((cap, index) => (
              <Fragment key={`${String(index)}-${cap}`}>
                {index > 0 && <span className="text-xs text-muted-foreground">+</span>}
                <Kbd>{cap}</Kbd>
              </Fragment>
            ))}
          </Fragment>
        ))}
      </KbdGroup>
      <span className="sr-only">{spoken}</span>
    </span>
  )
}
