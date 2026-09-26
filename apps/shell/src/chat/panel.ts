/**
 * The chat panel's state: whether it is open, the draft, the attachments and focus requests. It
 * lives apart from the conversation, on the boot path, so the header button, ⌘I and a mount's
 * prompt can open the chat before its code has loaded (`LazyShellChat`).
 */

import type { ChatContext } from '@company/mfe-agent'

import { quote } from './quote.ts'

/** The header's Assistant button, where focus goes back to when the aside closes. */
export const ASSISTANT_BUTTON_ID = 'shell-assistant'

/** What goes with the next message besides its text, shown as a chip the user can remove. */
export interface ChatAttachment {
  readonly id: string
  /** What the chip shows it is: quoted text, an action the user chose, or a page's context. */
  readonly kind: 'quote' | 'action' | 'context'
  readonly label: string
  readonly description: string
  /** Quoted in the message itself, so it stays in the conversation: the text the user selected. */
  readonly quote?: string
  /** Sent as the turn's AG-UI context and not shown: what a page attached to a prompt. */
  readonly context?: ChatContext
}

export interface ChatPanelState {
  readonly open: boolean
  readonly draft: string
  readonly attachments: readonly ChatAttachment[]
  /** Bumped to ask the composer for focus, which only the rendered panel can give. */
  readonly focusRequest: number
}

export const CLOSED_PANEL: ChatPanelState = {
  open: false,
  draft: '',
  attachments: [],
  focusRequest: 0,
}

/** A minimal external store, for `useSyncExternalStore`. */
export class Store<T> {
  #value: T
  readonly #listeners = new Set<() => void>()

  constructor(value: T) {
    this.#value = value
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): T => this.#value

  update(change: (value: T) => T): void {
    const next = change(this.#value)
    if (next === this.#value) return
    this.#value = next
    for (const listener of this.#listeners) listener()
  }
}

export class ChatPanel extends Store<ChatPanelState> {
  /** The last focus request a rendered composer took. */
  #focusTaken = 0

  constructor() {
    super(CLOSED_PANEL)
  }

  /**
   * Whether a composer should take focus for `request`: once for each request, so a panel that
   * mounts again later, opened by an approval rather than by the user, leaves focus where it is.
   */
  takeFocusRequest(request: number): boolean {
    if (request <= this.#focusTaken) return false
    this.#focusTaken = request
    return true
  }

  show(): void {
    this.update(state => (state.open ? state : { ...state, open: true }))
  }

  hide(): void {
    this.update(state => (state.open ? { ...state, open: false } : state))
  }

  /** Opens the panel and puts the caret in the composer. */
  focus(): void {
    this.update(state => ({ ...state, open: true, focusRequest: state.focusRequest + 1 }))
  }

  setDraft(draft: string): void {
    this.update(state => (state.draft === draft ? state : { ...state, draft }))
  }

  attach(attachment: ChatAttachment): void {
    this.update(state => ({
      ...state,
      attachments: [...state.attachments.filter(item => item.id !== attachment.id), attachment],
    }))
  }

  detach(id: string): void {
    this.update(state => ({
      ...state,
      attachments: state.attachments.filter(item => item.id !== id),
    }))
  }

  /** Empties the composer, once its message is sent or the conversation starts over. */
  clearComposer(): void {
    this.update(state =>
      state.draft === '' && state.attachments.length === 0
        ? state
        : { ...state, draft: '', attachments: [] },
    )
  }

  /**
   * The text the user selected on the page, quoted into their next message (agentic plan, B):
   * the shell's ⌘I. With no selection it only opens the chat.
   */
  askAbout(selection: string): void {
    const text = selection.trim()
    if (text !== '') {
      this.attach({
        id: 'selection',
        kind: 'quote',
        label: 'Selected text',
        description: text.length > 80 ? `${text.slice(0, 80)}…` : text,
        quote: quote(text),
      })
    }
    this.focus()
  }
}
