// @vitest-environment jsdom

/**
 * The transcript as it renders, over a fake client: asking again goes to the client's `reload`
 * and nothing else, and a part that throws as it renders is said to be missing, in its place.
 */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ChatSnapshot, ToolCallPart, UIMessage } from '@company/mfe-agent'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ReplyActions, ReplyFailed } from './message-actions.tsx'
import type * as ToolCallModule from './tool-call.tsx'
import { ChatPanel, Store } from './panel.ts'
import type { ShellChat } from './shell-chat.ts'
import { Transcript } from './transcript.tsx'

vi.mock('./tool-call.tsx', async original => ({
  ...(await original<typeof ToolCallModule>()),
  ToolCallView: ({ part }: { readonly part: ToolCallPart }): ReactNode => {
    if (part.name === 'boom') throw new Error('The renderer broke.')
    return createElement('p', null, `Called ${part.name}`)
  },
}))

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  // The scroller measures its viewport; jsdom has no layout to observe.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

let root: Root | undefined

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = undefined
  document.body.replaceChildren()
})

function render(element: ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root?.render(element)
  })
  return container
}

/** A chat whose client only records what it is asked to do. */
function fakeChat() {
  const client = {
    reload: vi.fn(() => Promise.resolve()),
    sendMessage: vi.fn(() => Promise.resolve()),
    editMessage: vi.fn(() => Promise.resolve()),
  }
  const chat = {
    client,
    panel: new ChatPanel(),
    stopped: new Store<ReadonlySet<string>>(new Set()),
    go: vi.fn(() => Promise.resolve()),
  } as unknown as ShellChat
  return { chat, client }
}

function press(container: HTMLElement, name: string): void {
  const button = [...container.querySelectorAll('button')].find(
    candidate => candidate.getAttribute('aria-label') === name || candidate.textContent === name,
  )
  if (button === undefined) throw new Error(`No button named ${name}`)
  act(() => {
    button.click()
  })
}

describe('asking again', () => {
  it('hands the last reply’s Ask again to the client’s reload, sending nothing of its own', () => {
    const { chat, client } = fakeChat()
    const container = render(
      createElement(ReplyActions, { chat, text: 'Hello.', last: true, idle: true }),
    )

    press(container, 'Ask again')

    expect(client.reload).toHaveBeenCalledOnce()
    expect(client.reload).toHaveBeenCalledWith()
    expect(client.sendMessage).not.toHaveBeenCalled()
    expect(client.editMessage).not.toHaveBeenCalled()
  })

  it('hands a failed reply’s Try again to the client’s reload too', () => {
    const { chat, client } = fakeChat()
    const container = render(
      createElement(ReplyFailed, { chat, error: new Error('The backend is down.') }),
    )

    press(container, 'Try again')

    expect(client.reload).toHaveBeenCalledOnce()
    expect(client.sendMessage).not.toHaveBeenCalled()
  })
})

describe('a part that cannot be shown', () => {
  const call = (id: string, name: string): ToolCallPart => ({
    type: 'tool-call',
    id,
    name,
    arguments: '{}',
    input: {},
    state: 'input-complete',
    output: { ok: true },
  })

  it('says so in its place, and the rest of the conversation is drawn', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', content: 'Show the wells' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', content: 'Here they are.' },
          call('call-1', 'boom'),
          call('call-2', 'show_summary'),
        ],
      },
    ]
    const snapshot = { messages, status: 'ready', interrupts: [] } as unknown as ChatSnapshot
    const { chat } = fakeChat()

    const container = render(createElement(Transcript, { chat, snapshot, empty: null }))

    expect(container.textContent).toContain('Show the wells')
    expect(container.textContent).toContain('Here they are.')
    expect(container.textContent).toContain('This part of the reply could not be shown.')
    expect(container.textContent).toContain('Called show_summary')
    expect(container.querySelector('[aria-label="Ask again"]')).not.toBeNull()
  })
})
