/**
 * The page's one shortcut registry (§26), wrapped so that keys typed into a palette stay typed.
 *
 * The design system's registry decides "am I in an input?" from `event.target`, and skips
 * modifier-less shortcuts when the answer is yes. React Aria's `Autocomplete` — what `Command`,
 * and so the command palette and the application finder, are built on — re-dispatches every
 * keydown from its input onto the virtually focused option, and cancels the original when that
 * copy is default-prevented. The copy bubbles to the document listener with an option as its
 * target, so `g` was read as the prefix of `g r` and the letter never reached the input.
 *
 * DOM focus never moved, so `document.activeElement` is the honest answer. A guard here rather
 * than an `isEnabled` on each shortcut, because a mounted application registers into this same
 * registry and would otherwise have to remember the same workaround.
 */

import { createShortcutRegistry, type ShortcutRegistry } from '@tecton/react/tecton/shortcuts'

function isEditable(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  if (node.isContentEditable) return true
  const tag = node.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** A keypress that belongs to a focused field but was re-dispatched somewhere else. */
function isForwardedFromField(event: KeyboardEvent): boolean {
  // The registry's own default is "a chord with Ctrl / ⌘ / Alt fires anywhere", and mod+k has to
  // keep closing the palette it is typed into, so only the unmodified keys are let through.
  if (event.ctrlKey || event.altKey || event.metaKey) return false
  return isEditable(document.activeElement) && !isEditable(event.target)
}

/**
 * Returned untouched rather than delegated when the guard trips, so the inner registry's pending
 * sequence buffer never sees the key either: a `g` swallowed here must not leave `g r` half-typed.
 */
export function createShellShortcutRegistry(): ShortcutRegistry {
  const registry = createShortcutRegistry()
  return {
    ...registry,
    handleKeyDown: event => (isForwardedFromField(event) ? false : registry.handleKeyDown(event)),
  }
}
