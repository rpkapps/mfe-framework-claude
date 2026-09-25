// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { isWaiting } from './waiting-focus.ts'

function panelWith(html: string): HTMLElement {
  const panel = document.createElement('div')
  panel.dataset['slot'] = 'chat-panel'
  panel.innerHTML = html
  document.body.append(panel)
  return panel
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('isWaiting', () => {
  it('is waiting with nothing focused, in the empty message box, or on a chat button', () => {
    const panel = panelWith('<textarea></textarea><button>Stop</button>')
    expect(isWaiting(panel)).toBe(true)

    panel.querySelector('textarea')?.focus()
    expect(isWaiting(panel)).toBe(true)

    panel.querySelector('button')?.focus()
    expect(isWaiting(panel)).toBe(true)
  })

  it('is not waiting while the user writes, or works outside the chat', () => {
    const panel = panelWith('<textarea></textarea>')
    const box = panel.querySelector('textarea')
    if (box === null) throw new Error('no box')
    box.value = 'the next question'
    box.focus()
    expect(isWaiting(panel)).toBe(false)

    const pageInput = document.createElement('input')
    document.body.append(pageInput)
    pageInput.focus()
    expect(isWaiting(panel)).toBe(false)
  })
})
