// @vitest-environment jsdom

/**
 * The shell's chat against an AG-UI backend in process: what it declares, what it sends with a
 * message, how a mount's prompt becomes a turn, and where the pipeline's approvals go.
 */

import { createMemoryRuntime, type MemoryRuntime } from '@company/mfe-react/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LazyShellChat } from './instance.ts'
import type { ShellChat } from './shell-chat.ts'

interface Run {
  readonly threadId: string
  readonly runId: string
  readonly messages: readonly { readonly role: string; readonly content?: unknown }[]
  readonly tools: readonly { readonly name: string }[]
  readonly context: readonly { readonly description: string; readonly value: string }[]
}

/** Answers every run with a line of text, or with the events a reply returns. */
function backend(reply: (run: Run) => readonly object[] = run => says(run, 'Hello.')) {
  const runs: Run[] = []
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    const run = JSON.parse(init.body as string) as Run
    runs.push(run)
    const body = reply(run)
      .map(event => `data: ${JSON.stringify(event)}\n\n`)
      .join('')
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
  })
  return { runs, fetch }
}

function says({ threadId, runId }: Run, text: string): object[] {
  return [
    { type: 'RUN_STARTED', threadId, runId },
    { type: 'TEXT_MESSAGE_START', messageId: `m-${runId}`, role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: `m-${runId}`, delta: text },
    { type: 'TEXT_MESSAGE_END', messageId: `m-${runId}` },
    { type: 'RUN_FINISHED', threadId, runId },
  ]
}

let memory: MemoryRuntime
let lazy: LazyShellChat | undefined

beforeEach(() => {
  memory = createMemoryRuntime({ initialEntries: ['/operations/wells'] })
})

afterEach(() => {
  lazy?.dispose()
  lazy = undefined
  memory.dispose()
})

/** The chat as boot installs it, its code not yet loaded. */
function install(server = backend()) {
  lazy = new LazyShellChat({
    runtime: memory.runtime,
    url: 'http://agent.test/agent',
    fetch: server.fetch,
    go: href => Promise.resolve(href),
  })
  return { lazy, server }
}

async function create(server = backend()): Promise<{ chat: ShellChat; server: typeof server }> {
  const installed = install(server)
  return { chat: await installed.lazy.load(), server }
}

describe('the shell chat', () => {
  it('declares its own tools and the page’s actions, and sends the agent context', async () => {
    memory.runtime.actions.registerHost({
      name: 'refresh',
      label: 'Refresh the page data',
      effect: 'read',
      execute: () => undefined,
    })
    const { chat: client, server } = await create()

    await client.send('Hi')

    const [run] = server.runs
    expect(run?.tools.map(tool => tool.name)).toEqual(
      expect.arrayContaining([
        'show_table',
        'show_chart',
        'show_summary',
        'ask_user',
        '_host__refresh',
      ]),
    )
    expect(run?.context[0]?.description).toContain('Where the user is')
  })

  it('quotes the selection into the message and sends a page’s context unseen, then clears both', async () => {
    const { chat: client, server } = await create()
    client.panel.askAbout('A-7 is flaring')
    client.panel.attach({
      id: 'prompt-context',
      kind: 'context',
      label: 'From Operations',
      description: 'Page context',
      context: { description: 'The alert', value: '{"alertId":"A-7"}' },
    })
    expect(client.panel.getSnapshot()).toMatchObject({ open: true, focusRequest: 1 })

    await client.send('Why?')

    const [run] = server.runs
    expect(run?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: '> A-7 is flaring\n\nWhy?',
    })
    expect(run?.context.at(-1)).toEqual({ description: 'The alert', value: '{"alertId":"A-7"}' })
    expect(client.panel.getSnapshot().attachments).toEqual([])
    expect(client.sent().at(-1)).toBe('Why?')
  })

  it('edits a question, keeping its quote, and asks again from there', async () => {
    const { chat: client, server } = await create()
    client.panel.askAbout('A-7 is flaring')
    await client.send('Why?')
    await client.send('And A-8?')
    const first = client.client.getSnapshot().messages.find(message => message.role === 'user')
    expect(first).toBeDefined()

    await client.edit(first?.id ?? '', '> A-7 is flaring', 'Since when?')

    const run = server.runs.at(-1)
    expect(run?.messages.filter(message => message.role === 'user')).toEqual([
      expect.objectContaining({ content: '> A-7 is flaring\n\nSince when?' }),
    ])
    expect(client.sent()).toEqual(['Why?', 'And A-8?', 'Since when?'])
  })

  it('notes where a reply was stopped, until the conversation starts over', async () => {
    const { chat: client } = await create()
    await client.send('Hi')
    const last = client.client.getSnapshot().messages.at(-1)

    client.stop()
    expect(client.stopped.getSnapshot()).toEqual(new Set([last?.id]))

    client.newConversation()
    expect(client.stopped.getSnapshot().size).toBe(0)
  })

  it('turns a mount’s prompt into a turn, with its context unseen', async () => {
    const { chat: client, server } = await create()

    expect(
      memory.runtime.agentContext.prompt({ message: 'Explain A-7', context: { alertId: 'A-7' } }),
    ).toBe(true)
    await vi.waitFor(() => {
      expect(server.runs).toHaveLength(1)
    })

    expect(client.panel.getSnapshot().open).toBe(true)
    expect(server.runs[0]?.messages.at(-1)).toMatchObject({ content: 'Explain A-7' })
    expect(server.runs[0]?.context.at(-1)).toMatchObject({ value: '{"alertId":"A-7"}' })
  })

  it('fills the composer with a prompt to review, its context a removable chip', async () => {
    const { chat: client, server } = await create()

    memory.runtime.agentContext.prompt({
      message: 'Draft a note',
      context: { id: 1 },
      submit: false,
    })

    await vi.waitFor(() => {
      expect(client.panel.getSnapshot().draft).toBe('Draft a note')
    })
    expect(server.runs).toHaveLength(0)
    expect(client.panel.getSnapshot()).toMatchObject({
      open: true,
      draft: 'Draft a note',
      attachments: [{ id: 'prompt-context', label: 'From the shell' }],
    })
  })

  it('asks the pipeline’s approvals in the chat, opening it', async () => {
    const { chat: client } = await create()
    let ran = false
    memory.runtime.actions.registerHost({
      name: 'clear',
      label: 'Clear the canvas',
      effect: 'destructive',
      execute: () => {
        ran = true
      },
    })

    const result = memory.runtime.actions.execute('@host:clear', { caller: 'agent' })
    await vi.waitFor(() => {
      expect(client.client.getInterrupts()).toHaveLength(1)
    })
    expect(client.panel.getSnapshot().open).toBe(true)
    const [card] = client.client.getInterrupts()
    if (card?.kind === 'tool-approval') card.resolveInterrupt(true)

    expect(await result).toMatchObject({ status: 'executed' })
    expect(ran).toBe(true)
  })

  it('starts over with a new thread and forgets the Widgets’ outputs', async () => {
    const { chat: client, server } = await create()
    await client.send('Hi')
    client.outputs.record('call-1', 'well-design', 'selected', { wellId: 'htdp' })
    const thread = client.client.getSnapshot().threadId

    client.newConversation()
    await client.send('Again')

    expect(server.runs[1]?.threadId).not.toBe(thread)
    expect(server.runs[1]?.messages).toHaveLength(1)
    expect(JSON.stringify(server.runs[1]?.context)).not.toContain('well-design')
  })
})

describe('suggestions', () => {
  it('hands a pressed suggestion on as the prompt of the mount that offered it', async () => {
    const { chat: client, server } = await create()
    memory.runtime.agentContext.suggest({ definitionId: 'operations', mountToken: 'm-1' }, [
      { message: 'Open the wells inventory', context: { from: 'overview' } },
      { message: 'Draft a shift note', submit: false },
    ])
    const [send, draft] = memory.runtime.agentContext.getSuggestions()
    if (send === undefined || draft === undefined) throw new Error('No suggestions')

    client.offer(draft)
    expect(client.panel.getSnapshot().draft).toBe('Draft a shift note')

    client.offer(send)
    await vi.waitFor(() => {
      expect(server.runs).toHaveLength(1)
    })
    expect(server.runs[0]?.messages.at(-1)).toMatchObject({ content: 'Open the wells inventory' })
    expect(server.runs[0]?.context.at(-1)).toMatchObject({
      description: "What operations attached to the user's message",
    })
  })
})

describe('before the chat has loaded', () => {
  it('opens at once for a mount’s prompt, loads, and sends it', async () => {
    const { lazy: chat, server } = install()

    expect(memory.runtime.agentContext.prompt({ message: 'Explain A-7' })).toBe(true)
    expect(chat.panel.getSnapshot().open).toBe(true)

    await vi.waitFor(() => {
      expect(server.runs).toHaveLength(1)
    })
    expect(server.runs[0]?.messages.at(-1)).toMatchObject({ content: 'Explain A-7' })
  })

  it('loads to ask an approval', async () => {
    const { lazy: chat } = install()
    memory.runtime.actions.registerHost({
      name: 'clear',
      label: 'Clear the canvas',
      effect: 'destructive',
      execute: () => undefined,
    })

    const result = memory.runtime.actions.execute('@host:clear', { caller: 'agent' })
    const loaded = await chat.load()
    await vi.waitFor(() => {
      expect(loaded.client.getInterrupts()).toHaveLength(1)
    })
    const [card] = loaded.client.getInterrupts()
    if (card?.kind === 'tool-approval') card.resolveInterrupt(false)

    expect(await result).toMatchObject({ status: 'declined' })
  })

  it('lets go of the runtime when it is replaced', () => {
    const { lazy: chat } = install()
    chat.dispose()
    expect(memory.runtime.agentContext.prompt({ message: 'Anyone?' })).toBe(false)
  })
})
