/**
 * Where focus goes when the assistant stops to ask something (an approval, a backend's question,
 * `ask_user`) and after the answer. It moves to the question only when the user is waiting on the
 * assistant: focus in the chat's empty message box, on one of the chat's buttons, or nowhere. A
 * user typing the next message or working in the App keeps their focus, and hears the question
 * announced with the way to it instead. The card itself takes focus, not its first button, so an
 * Enter meant for something else cannot approve anything. Once the card goes, focus moves to the
 * next question waiting, or back to the message box, never to the page's body.
 */

import { useEffect, type RefObject } from 'react'

import type { ShellChat } from './shell-chat.ts'

/** Marks a card that waits for an answer; the next one to focus is found by it. */
export const WAITING = 'data-chat-waiting'

function panelOf(element: Element): Element | null {
  return element.closest('[data-slot="chat-panel"]')
}

/** Whether the user is waiting on the assistant, rather than doing something focus must not leave. */
export function isWaiting(panel: Element | null): boolean {
  const active = document.activeElement
  if (active === null || active === document.body) return true
  if (panel === null || !panel.contains(active)) return false
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    return active.value.trim() === ''
  }
  return true
}

/**
 * Focuses the card as it appears when the user is waiting; otherwise announces `question`, then
 * `way`, how to reach the card from where the user is, which only the card's caller knows. Once
 * per card.
 */
export function useFocusWhenWaiting(
  chat: ShellChat,
  card: RefObject<HTMLElement | null>,
  question: string,
  way: string,
): void {
  useEffect(() => {
    const element = card.current
    if (element === null) return
    if (isWaiting(panelOf(element))) {
      element.focus()
      return
    }
    // A title the agent wrote may not end a sentence; the way to the card is a sentence of its own.
    chat.announce(`${question}${/[.?!…:]$/.test(question) ? '' : '.'} ${way}`)
    // Once, as the card appears: a later render is the same question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/**
 * After the answer to `card`, whose press removes it: the next question waiting, or the message
 * box. Only when focus was in the card, so an answer given by other means moves nothing.
 */
export function focusAfterAnswer(chat: ShellChat, card: HTMLElement | null): void {
  if (card === null || !card.contains(document.activeElement)) return
  const panel = panelOf(card)
  requestAnimationFrame(() => {
    const next = [...(panel?.querySelectorAll<HTMLElement>(`[${WAITING}]`) ?? [])].find(
      other => other !== card && other.isConnected,
    )
    if (next !== undefined) next.focus()
    else chat.panel.focus()
  })
}
