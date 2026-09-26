import { EventType, type Message, type RunAgentInput } from '@ag-ui/core'
import { describe, expect, it, vi } from 'vitest'

import { calls, fails, interrupts, says, scriptedBackend, type Reply } from './__tests__/backend.ts'
import { ChatClient } from './chat-client.ts'
import { fetchServerSentEvents } from './connection.ts'
import type { ChatTool, ToolCallPart, ToolExecutionContext } from './types.ts'

const acknowledge = {
  id: 'call-1',
  name: 'operations__acknowledge-alert',
  args: { alertId: 'A-7' },
}

function tool(execute: ChatTool['execute'] = () => ({ acknowledged: true })): ChatTool {
  return {
    name: 'operations__acknowledge-alert',
    description: 'Acknowledge an alert',
    inputSchema: { type: 'object', properties: { alertId: { type: 'string' } } },
    execute,
  }
}

function toolCalls(client: ChatClient): ToolCallPart[] {
  return client
    .getMessages()
    .flatMap(message => message.parts)
    .filter((part): part is ToolCallPart => part.type === 'tool-call')
}

/** Resolves once the client shows an interrupt, as a card would appear. */
async function nextInterrupt(client: ChatClient) {
  await vi.waitFor(() => {
    expect(client.getInterrupts()).not.toHaveLength(0)
  })
  const [interrupt] = client.getInterrupts()
  if (interrupt === undefined) throw new Error('No interrupt')
  return interrupt
}

describe('a turn', () => {
  it('sends the message and shows the answer, as AG-UI messages underneath', async () => {
    const backend = scriptedBackend(says('Hello there.'))
    const onFinish = vi.fn()
    const client = new ChatClient({ connection: backend.connection, onFinish })

    await client.sendMessage('Hi')

    expect(client.getMessages().map(({ role, parts }) => ({ role, parts }))).toEqual([
      { role: 'user', parts: [{ type: 'text', content: 'Hi' }] },
      { role: 'assistant', parts: [{ type: 'text', content: 'Hello there.' }] },
    ])
    expect(client.getHistory().map(message => message.role)).toEqual(['user', 'assistant'])
    expect(client.getStatus()).toBe('ready')
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }))
  })

  it('ignores an empty message', async () => {
    const backend = scriptedBackend(says('Hello.'))
    const client = new ChatClient({ connection: backend.connection })

    await client.sendMessage('   ')

    expect(backend.requests).toHaveLength(0)
  })

  it('reads the tools and the context again for every run, and sends them as AG-UI', async () => {
    const backend = scriptedBackend(calls(acknowledge), says('Done.'))
    const tools = vi.fn(() => [tool()])
    const agentContext = vi.fn(() => [{ description: 'The selected alert', value: '"A-7"' }])
    const client = new ChatClient({ connection: backend.connection, tools, agentContext })

    await client.sendMessage('Acknowledge it')

    expect(tools).toHaveBeenCalledTimes(2)
    expect(agentContext).toHaveBeenCalledTimes(2)
    expect(backend.requests[0]?.tools).toEqual([
      {
        name: 'operations__acknowledge-alert',
        description: 'Acknowledge an alert',
        parameters: { type: 'object', properties: { alertId: { type: 'string' } } },
      },
    ])
    expect(backend.requests[0]?.context).toEqual([
      { description: 'The selected alert', value: '"A-7"' },
    ])
  })
})

describe('the messages a view renders', () => {
  it('keep an earlier message’s object while the reply streams', async () => {
    const backend = scriptedBackend(says('First.'), input => [
      { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm-2', role: 'assistant' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm-2', delta: 'Streaming ' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm-2', delta: 'a reply.' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm-2' },
      { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId },
    ])
    const client = new ChatClient({ connection: backend.connection })
    await client.sendMessage('Hi')
    const [question, answer] = client.getMessages()

    const replies: string[] = []
    client.subscribe(() => {
      const [first, second, , reply] = client.getMessages()
      expect(first).toBe(question)
      expect(second).toBe(answer)
      const part = reply?.parts[0]
      if (part?.type === 'text') replies.push(part.content)
    })
    await client.sendMessage('Again')

    expect(replies).toContain('Streaming ')
    expect(replies.at(-1)).toBe('Streaming a reply.')
  })
})

describe('a turn’s own context', () => {
  it('goes with every run of the turn after the agent context, and not with the next turn', async () => {
    const backend = scriptedBackend(calls(acknowledge), says('Done.'), says('Hello.'))
    const client = new ChatClient({
      connection: backend.connection,
      tools: [tool()],
      agentContext: () => [{ description: 'Where the user is', value: '{}' }],
    })
    const selected = { description: 'Text the user selected', value: '"A-7 is flaring"' }

    await client.sendMessage('What is this?', { context: [selected] })
    await client.sendMessage('Thanks')

    expect(backend.requests.map(request => request.context.length)).toEqual([2, 2, 1])
    expect(backend.requests[1]?.context.at(-1)).toEqual(selected)
    expect(client.getMessages()[0]?.parts).toEqual([{ type: 'text', content: 'What is this?' }])
  })
})

describe('a turn’s own forwarded props', () => {
  it('are merged over the client’s for that turn only', async () => {
    const backend = scriptedBackend(says('Ok.'))
    const client = new ChatClient({
      connection: backend.connection,
      forwardedProps: { app: 'shell' },
    })

    await client.sendMessage('Submit', {
      forwardedProps: { a2uiAction: { userAction: { name: 'submit' } } },
    })
    await client.sendMessage('Thanks')

    expect(backend.requests[0]?.forwardedProps).toEqual({
      app: 'shell',
      a2uiAction: { userAction: { name: 'submit' } },
    })
    expect(backend.requests[1]?.forwardedProps).toEqual({ app: 'shell' })
  })
})

describe('the page’s tools', () => {
  it('runs a pending call, answers it with a tool message, and continues the run', async () => {
    const backend = scriptedBackend(calls(acknowledge), says('Acknowledged.'))
    const execute = vi.fn((_input: unknown, _context: ToolExecutionContext) => ({
      acknowledged: true,
    }))
    const client = new ChatClient({ connection: backend.connection, tools: [tool(execute)] })

    await client.sendMessage('Acknowledge A-7')

    const firstRunId = backend.requests[0]?.runId
    expect(execute).toHaveBeenCalledWith(
      { alertId: 'A-7' },
      {
        toolCallId: 'call-1',
        threadId: client.getSnapshot().threadId,
        runId: firstRunId,
        signal: expect.any(AbortSignal) as unknown,
      },
    )
    expect(backend.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      content: '{"acknowledged":true}',
    })
    expect(toolCalls(client)).toEqual([
      expect.objectContaining({
        id: 'call-1',
        state: 'complete',
        input: { alertId: 'A-7' },
        output: { acknowledged: true },
      }),
    ])
    expect(client.getMessages().at(-1)?.parts).toEqual([{ type: 'text', content: 'Acknowledged.' }])
  })

  it('answers a tool that throws with the error, and marks the call failed', async () => {
    const backend = scriptedBackend(calls(acknowledge), says('It failed.'))
    const client = new ChatClient({
      connection: backend.connection,
      tools: [
        tool(() => {
          throw new Error('Alert service down')
        }),
      ],
    })

    await client.sendMessage('Acknowledge A-7')

    expect(backend.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      error: 'Alert service down',
    })
    expect(toolCalls(client)[0]?.state).toBe('error')
  })

  it('aborts the signal of a tool still running when the user stops the turn', async () => {
    const backend = scriptedBackend(calls(acknowledge), says('Never reached.'))
    let aborted = false
    const client = new ChatClient({
      connection: backend.connection,
      tools: [
        tool(
          (_input, { signal }) =>
            new Promise(resolve => {
              signal.addEventListener('abort', () => {
                aborted = true
                resolve({ status: 'declined' })
              })
            }),
        ),
      ],
    })

    const turn = client.sendMessage('Ask me')
    await vi.waitFor(() => {
      expect(toolCalls(client)[0]?.state).toBe('input-complete')
    })
    client.stop()
    await turn

    expect(aborted).toBe(true)
    expect(backend.requests).toHaveLength(1)
    expect(client.getHistory().at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call-1' })
  })

  it('answers a pending call to a tool the page does not have with an error, and continues', async () => {
    const backend = scriptedBackend(
      calls({ id: 'call-9', name: 'shut_in_well', args: { wellId: 'W-1' } }),
      says('I cannot shut wells in from here.'),
      says('Hello.'),
    )
    const client = new ChatClient({ connection: backend.connection, tools: [tool()] })

    await client.sendMessage('Shut in W-1')

    const error = 'No tool named "shut_in_well" is available on this page.'
    expect(backend.requests).toHaveLength(2)
    expect(backend.requests[1]?.messages.slice(1)).toEqual([
      expect.objectContaining({ role: 'assistant' }),
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'call-9',
        content: JSON.stringify({ error }),
        error,
      }),
    ])
    expect(toolCalls(client)[0]).toMatchObject({ name: 'shut_in_well', state: 'error' })
    expect(client.getStatus()).toBe('ready')

    await client.sendMessage('Hi')
    expect(backend.requests[2]?.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ])
  })

  it('keeps an answered unknown call within the turn’s run limit', async () => {
    const backend = scriptedBackend(input =>
      calls({ id: input.runId, name: 'made_up_tool', args: {} })(input, 0),
    )
    const client = new ChatClient({
      connection: backend.connection,
      tools: [tool()],
      maxRunsPerTurn: 2,
    })

    await client.sendMessage('Do something')

    expect(backend.requests).toHaveLength(2)
    expect(client.getError()?.message).toMatch(/more than 2 runs/)
    expect(
      client
        .getHistory()
        .filter(message => message.role === 'tool')
        .map(m => m.toolCallId),
    ).toEqual(backend.requests.map(request => request.runId))
  })

  it.each([
    [
      'TanStack AI’s client-tool interrupt',
      {
        id: 'client_tool_call-1',
        reason: 'tanstack:client_tool_execution',
        toolCallId: 'call-1',
        metadata: { kind: 'client_tool' },
      },
    ],
    [
      'any interrupt on a page tool’s call',
      { id: 'client_tool_call-1', reason: 'tool_call', toolCallId: 'call-1' },
    ],
  ])(
    'runs a page tool the backend stops on, rather than asking the user (%s)',
    async (_, raised) => {
      const backend = scriptedBackend(interrupts([acknowledge], raised), says('Acknowledged.'))
      const client = new ChatClient({ connection: backend.connection, tools: [tool()] })

      await client.sendMessage('Acknowledge A-7')

      expect(backend.requests[1]).toMatchObject({
        parentRunId: backend.requests[0]?.runId,
        resume: [
          {
            interruptId: 'client_tool_call-1',
            status: 'resolved',
            payload: { acknowledged: true },
          },
        ],
      })
      expect(backend.requests[1]?.messages.at(-1)).toMatchObject({
        role: 'tool',
        toolCallId: 'call-1',
      })
    },
  )

  it('shows the pipeline’s question as the call’s approval, and resolves it with the answer', async () => {
    const backend = scriptedBackend(calls(acknowledge), says('Acknowledged.'))
    let approved: boolean | undefined
    const client: ChatClient = new ChatClient({
      connection: backend.connection,
      tools: [
        tool(async input => {
          approved = await client.requestApproval({
            toolName: 'operations__acknowledge-alert',
            input,
            label: 'Acknowledge alert',
          })
          return { acknowledged: approved }
        }),
      ],
    })

    const turn = client.sendMessage('Acknowledge A-7')
    const interrupt = await nextInterrupt(client)
    expect(interrupt).toMatchObject({
      kind: 'tool-approval',
      source: 'page',
      toolName: 'operations__acknowledge-alert',
      toolCallId: 'call-1',
      originalArgs: { alertId: 'A-7' },
      label: 'Acknowledge alert',
    })
    expect(toolCalls(client)[0]).toMatchObject({
      state: 'approval-requested',
      approval: { id: interrupt.id, needsApproval: true },
    })

    if (interrupt.kind === 'tool-approval') interrupt.resolveInterrupt(true)
    await turn

    expect(approved).toBe(true)
    expect(client.getInterrupts()).toEqual([])
    expect(toolCalls(client)[0]).toMatchObject({
      state: 'complete',
      approval: { approved: true },
    })
  })
})

describe('a tool that does not follow up', () => {
  const show = { id: 'call-2', name: 'show_summary', args: { title: 'A-7' } }
  const summary: ChatTool = {
    name: 'show_summary',
    description: 'Show a summary card',
    followUp: false,
    execute: () => ({ shown: true }),
  }

  it('ends the turn once it answered, and the answer goes with the next run', async () => {
    const backend = scriptedBackend(calls(show), says('Anything else?'))
    const client = new ChatClient({ connection: backend.connection, tools: [summary] })

    await client.sendMessage('Summarise A-7')
    expect(backend.requests).toHaveLength(1)
    expect(client.getStatus()).toBe('ready')
    expect(toolCalls(client)[0]).toMatchObject({ state: 'complete', output: { shown: true } })

    await client.sendMessage('Thanks')
    expect(backend.requests[1]?.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ])
  })

  it('keeps the turn going when another call in the run wants the result', async () => {
    const backend = scriptedBackend(calls(show, acknowledge), says('Done.'))
    const client = new ChatClient({ connection: backend.connection, tools: [summary, tool()] })

    await client.sendMessage('Summarise and acknowledge A-7')

    expect(backend.requests).toHaveLength(2)
  })

  it('decides from the result when followUp is a function: a refused render lets the agent retry', async () => {
    const backend = scriptedBackend(calls(show), says('Fixed it.'))
    const client = new ChatClient({
      connection: backend.connection,
      tools: [
        {
          ...summary,
          followUp: result => (result as { status?: string }).status !== 'shown',
          execute: () => ({ status: 'invalid', error: 'No title' }),
        },
      ],
    })

    await client.sendMessage('Summarise A-7')

    expect(backend.requests).toHaveLength(2)
  })

  it('owes an interrupt’s answer to the next run instead of resuming at once', async () => {
    const raised = { id: 'client_tool_call-2', reason: 'tool_call', toolCallId: 'call-2' }
    const backend = scriptedBackend(interrupts([show], raised), says('Anything else?'))
    const client = new ChatClient({ connection: backend.connection, tools: [summary] })

    await client.sendMessage('Summarise A-7')
    expect(backend.requests).toHaveLength(1)

    await client.sendMessage('Thanks')
    expect(backend.requests[1]?.resume).toEqual([
      { interruptId: 'client_tool_call-2', status: 'resolved', payload: { shown: true } },
    ])
  })
})

describe('the backend’s interrupts', () => {
  const shutIn = { id: 'call-9', name: 'shut_in_well', args: { wellId: 'W-1' } }
  const approval = {
    id: 'approval-9',
    reason: 'tool_call',
    message: 'Approval required for tool call: shut_in_well',
    toolCallId: 'call-9',
  }

  it.each([true, false])(
    'shows a backend tool’s approval as a card and resumes with the answer (approved: %s)',
    async approved => {
      const backend = scriptedBackend(interrupts([shutIn], approval), says('Done.'))
      const client = new ChatClient({ connection: backend.connection })

      const turn = client.sendMessage('Shut in W-1')
      const interrupt = await nextInterrupt(client)
      expect(interrupt).toMatchObject({
        kind: 'tool-approval',
        source: 'backend',
        toolName: 'shut_in_well',
        originalArgs: { wellId: 'W-1' },
        message: 'Approval required for tool call: shut_in_well',
      })
      expect(client.getStatus()).toBe('ready')
      expect(toolCalls(client)[0]?.state).toBe('approval-requested')

      if (interrupt.kind === 'tool-approval') interrupt.resolveInterrupt(approved)
      await turn

      expect(backend.requests[1]).toMatchObject({
        parentRunId: backend.requests[0]?.runId,
        resume: [
          {
            interruptId: 'approval-9',
            status: 'resolved',
            payload: {
              approved,
              toolCall: { callId: 'call-9', name: 'shut_in_well', arguments: { wellId: 'W-1' } },
            },
          },
        ],
      })
      expect(toolCalls(client)[0]).toMatchObject({ approval: { approved } })
    },
  )

  it('resumes any other interrupt with the payload the user gives', async () => {
    const backend = scriptedBackend(
      interrupts([], { id: 'pick-1', reason: 'input_required', message: 'Which well?' }),
      says('Thanks.'),
    )
    const client = new ChatClient({ connection: backend.connection })

    const turn = client.sendMessage('Shut one in')
    const interrupt = await nextInterrupt(client)
    expect(interrupt).toMatchObject({ kind: 'generic', reason: 'input_required' })
    if (interrupt.kind === 'generic') interrupt.resolveInterrupt({ wellId: 'W-2' })
    await turn

    expect(backend.requests[1]?.resume).toEqual([
      { interruptId: 'pick-1', status: 'resolved', payload: { wellId: 'W-2' } },
    ])
  })

  it('tells the backend a question was dropped when the user writes again instead', async () => {
    const backend = scriptedBackend(interrupts([shutIn], approval), says('Declined.'), says('Hi.'))
    const client = new ChatClient({ connection: backend.connection })

    void client.sendMessage('Shut in W-1')
    await nextInterrupt(client)
    await client.sendMessage('Never mind')

    expect(backend.requests[1]?.resume).toEqual([
      { interruptId: 'approval-9', status: 'cancelled' },
    ])
    expect(backend.requests[2]?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'Never mind',
    })
  })

  it('carries a question the user stopped on into the next run', async () => {
    const backend = scriptedBackend(interrupts([shutIn], approval), says('Hi.'))
    const client = new ChatClient({ connection: backend.connection })

    const turn = client.sendMessage('Shut in W-1')
    await nextInterrupt(client)
    client.stop()
    await turn
    await client.sendMessage('Hello')

    expect(client.getInterrupts()).toEqual([])
    expect(backend.requests[1]?.resume).toEqual([
      { interruptId: 'approval-9', status: 'cancelled' },
    ])
  })
})

describe('stopping and failing', () => {
  it('answers the page’s open question as declined when the user stops', async () => {
    const backend = scriptedBackend(calls(acknowledge), says('Declined.'))
    let approved: boolean | undefined
    const client: ChatClient = new ChatClient({
      connection: backend.connection,
      tools: [
        tool(async input => {
          approved = await client.requestApproval({
            toolName: 'operations__acknowledge-alert',
            input,
          })
          return { acknowledged: approved }
        }),
      ],
    })

    const turn = client.sendMessage('Acknowledge A-7')
    await nextInterrupt(client)
    client.stop()
    await turn

    expect(approved).toBe(false)
    expect(backend.requests).toHaveLength(1)
    expect(client.getHistory().at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call-1' })
  })

  it('shows a run’s error and reports it', async () => {
    const backend = scriptedBackend(fails('Model overloaded'))
    const onError = vi.fn()
    const client = new ChatClient({ connection: backend.connection, onError })

    await client.sendMessage('Hi')

    expect(client.getStatus()).toBe('error')
    expect(client.getError()?.message).toBe('Model overloaded')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('keeps the turn’s error when onError throws, and calls it once', async () => {
    const backend = scriptedBackend(fails('Model overloaded'), says('Hello.'))
    const onError = vi.fn(() => {
      throw new Error('Handler broke')
    })
    const client = new ChatClient({ connection: backend.connection, onError })

    await expect(client.sendMessage('Hi')).rejects.toThrow('Handler broke')

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Model overloaded' }))
    expect(client.getError()?.message).toBe('Model overloaded')
    await client.sendMessage('Again')
    expect(client.getStatus()).toBe('ready')
  })

  it('answers a call the failed run made, so the next request pairs it and nothing streams', async () => {
    const backend = scriptedBackend(
      input => [
        { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId },
        { type: EventType.TOOL_CALL_START, toolCallId: 'call-1', toolCallName: acknowledge.name },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: 'call-1', delta: '{"alertId":' },
        { type: EventType.RUN_ERROR, message: 'Model overloaded' },
      ],
      says('Hello.'),
    )
    const client = new ChatClient({ connection: backend.connection, tools: [tool()] })

    await client.sendMessage('Acknowledge A-7')

    expect(client.getError()?.message).toBe('Model overloaded')
    expect(toolCalls(client)[0]?.state).toBe('error')
    expect(client.getHistory().at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call-1' })

    await client.sendMessage('Hi')
    expect(backend.requests[1]?.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ])
  })

  it('leaves a failed run’s call to the backend whose question holds it', async () => {
    const shutIn = { id: 'call-9', name: 'shut_in_well', args: { wellId: 'W-1' } }
    const approval = { id: 'approval-9', reason: 'tool_call', toolCallId: 'call-9' }
    const backend = scriptedBackend(
      interrupts([shutIn], approval),
      fails('Model overloaded'),
      says('Hello.'),
    )
    const client = new ChatClient({ connection: backend.connection })

    const turn = client.sendMessage('Shut in W-1')
    const interrupt = await nextInterrupt(client)
    if (interrupt.kind === 'tool-approval') interrupt.resolveInterrupt(true)
    await turn
    expect(client.getError()?.message).toBe('Model overloaded')
    await client.sendMessage('Hi')

    expect(client.getHistory().some(message => message.role === 'tool')).toBe(false)
    expect(backend.requests[2]?.resume).toEqual([
      { interruptId: 'approval-9', status: 'cancelled' },
    ])
  })

  it('stops a turn that keeps calling tools', async () => {
    const backend = scriptedBackend(input => calls({ ...acknowledge, id: input.runId })(input, 0))
    const client = new ChatClient({
      connection: backend.connection,
      tools: [tool()],
      maxRunsPerTurn: 3,
    })

    await client.sendMessage('Acknowledge forever')

    expect(backend.requests).toHaveLength(3)
    expect(client.getError()?.message).toMatch(/more than 3 runs/)
  })

  it('starts a new thread on clear', async () => {
    const backend = scriptedBackend(says('Hello.'))
    const client = new ChatClient({ connection: backend.connection })
    await client.sendMessage('Hi')
    const { threadId } = client.getSnapshot()

    client.clear()

    expect(client.getMessages()).toEqual([])
    expect(client.getSnapshot().threadId).not.toBe(threadId)
  })

  it('runs the last message again on reload, without what answered it', async () => {
    const backend = scriptedBackend(says('First.'), says('Second.'))
    const client = new ChatClient({ connection: backend.connection })
    await client.sendMessage('Hi')

    await client.reload()

    expect(client.getMessages().map(message => message.parts)).toEqual([
      [{ type: 'text', content: 'Hi' }],
      [{ type: 'text', content: 'Second.' }],
    ])
  })

  it('sends the reloaded turn’s own context and forwarded props again', async () => {
    const backend = scriptedBackend(says('One.'), says('Two.'), says('Two again.'))
    const client = new ChatClient({
      connection: backend.connection,
      forwardedProps: { app: 'shell' },
    })
    const pressed = { description: 'The user pressed a button', value: '"submit"' }
    const a2uiAction = { userAction: { name: 'submit' } }
    await client.sendMessage('Hi', { context: [{ description: 'First', value: '1' }] })
    await client.sendMessage('Submit', { context: [pressed], forwardedProps: { a2uiAction } })

    await client.reload()

    expect(backend.requests[2]?.context).toEqual([pressed])
    expect(backend.requests[2]?.forwardedProps).toEqual({ app: 'shell', a2uiAction })
    expect(backend.requests[2]?.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
  })

  it('reloads a message restored from a stored history with no options of its own', async () => {
    const backend = scriptedBackend(says('Hello.'))
    const client = new ChatClient({
      connection: backend.connection,
      initialMessages: [{ id: 'u-1', role: 'user', content: 'Hi' }],
    })

    await client.reload()

    expect(backend.requests[0]?.context).toEqual([])
    expect(backend.requests[0]?.forwardedProps).toEqual({})
  })
})

describe('turns that overlap', () => {
  const shutIn = { id: 'call-9', name: 'shut_in_well', args: { wellId: 'W-1' } }
  const approval = { id: 'approval-9', reason: 'tool_call', toolCallId: 'call-9' }

  /** A tool that runs until the test releases it. */
  function held() {
    let release: (value: unknown) => void = () => undefined
    const execute = vi.fn(
      () =>
        new Promise(resolve => {
          release = resolve
        }),
    )
    return { execute, release: (value: unknown) => release(value) }
  }

  it('runs a message sent while a turn is in flight after it, never beside it', async () => {
    const backend = scriptedBackend(says('One.'), says('Two.'))
    const client = new ChatClient({ connection: backend.connection })

    await Promise.all([client.sendMessage('First'), client.sendMessage('Second')])

    expect(backend.requests[1]?.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
  })

  it('runs none of the run’s other calls once the user stops', async () => {
    const backend = scriptedBackend(calls(acknowledge, { ...acknowledge, id: 'call-2' }))
    const { execute, release } = held()
    const client = new ChatClient({ connection: backend.connection, tools: [tool(execute)] })

    const turn = client.sendMessage('Acknowledge both')
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce()
    })
    client.stop()
    release({ acknowledged: true })
    await turn

    expect(execute).toHaveBeenCalledOnce()
    expect(client.getHistory().filter(message => message.role === 'tool')).toHaveLength(2)
  })

  it('keeps a tool that finishes after clear out of the new conversation', async () => {
    const backend = scriptedBackend(calls(acknowledge))
    const { execute, release } = held()
    const client = new ChatClient({ connection: backend.connection, tools: [tool(execute)] })

    const turn = client.sendMessage('Acknowledge A-7')
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce()
    })
    client.clear()
    release({ acknowledged: true })
    await turn

    expect(client.getHistory()).toEqual([])
  })

  it('starts the new conversation clean when cleared on a backend’s question', async () => {
    const backend = scriptedBackend(interrupts([shutIn], approval), says('Hello.'))
    const client = new ChatClient({ connection: backend.connection })

    const turn = client.sendMessage('Shut in W-1')
    await nextInterrupt(client)
    client.clear()
    await turn
    await client.sendMessage('Hi')

    expect(client.getError()).toBeUndefined()
    expect(backend.requests[1]).not.toHaveProperty('resume')
  })

  it('resumes as cancelled the interrupt of a page tool the user stopped', async () => {
    const raised = { id: 'client_tool_call-1', reason: 'tool_call', toolCallId: 'call-1' }
    const backend = scriptedBackend(interrupts([acknowledge], raised), says('Hello.'))
    const { execute, release } = held()
    const client = new ChatClient({ connection: backend.connection, tools: [tool(execute)] })

    const turn = client.sendMessage('Acknowledge A-7')
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce()
    })
    client.stop()
    release({ acknowledged: true })
    await turn
    await client.sendMessage('Hi')

    expect(client.getError()).toBeUndefined()
    expect(backend.requests[1]?.resume).toEqual([
      { interruptId: 'client_tool_call-1', status: 'cancelled' },
    ])
  })

  it('asks the pipeline’s questions for two calls of one tool on their own calls', async () => {
    const backend = scriptedBackend(
      interrupts(
        [acknowledge, { ...acknowledge, id: 'call-2' }],
        { id: 'client_tool_call-1', reason: 'tool_call', toolCallId: 'call-1' },
        { id: 'client_tool_call-2', reason: 'tool_call', toolCallId: 'call-2' },
      ),
      says('Both acknowledged.'),
    )
    const client: ChatClient = new ChatClient({
      connection: backend.connection,
      tools: [
        tool(async input => ({
          acknowledged: await client.requestApproval({
            toolName: 'operations__acknowledge-alert',
            input,
          }),
        })),
      ],
    })

    const turn = client.sendMessage('Acknowledge both')
    const cards: (string | undefined)[] = []
    for (let index = 0; index < 2; index += 1) {
      const card = await nextInterrupt(client)
      if (card.kind !== 'tool-approval') throw new Error('Not an approval')
      cards.push(card.toolCallId)
      card.resolveInterrupt(true)
    }
    await turn

    expect(cards).toEqual(['call-1', 'call-2'])
  })

  it('fails the turn when a tool’s followUp throws, instead of rejecting', async () => {
    const backend = scriptedBackend(calls(acknowledge))
    const client = new ChatClient({
      connection: backend.connection,
      tools: [
        {
          ...tool(),
          followUp: () => {
            throw new Error('Bad result')
          },
        },
      ],
    })

    await client.sendMessage('Acknowledge A-7')

    expect(client.getStatus()).toBe('error')
    expect(client.getError()?.message).toBe('Bad result')
  })
})

/** The id of the `index`-th user message in the history. */
function userMessageId(client: ChatClient, index: number): string {
  const id = client.getHistory().filter(message => message.role === 'user')[index]?.id
  if (id === undefined) throw new Error(`No user message ${String(index)}`)
  return id
}

/**
 * A backend whose first run starts streaming and goes on until the client aborts it; the runs
 * after it are answered by `then`.
 */
function streamsUntilAborted(then: Reply) {
  const requests: RunAgentInput[] = []
  const encoder = new TextEncoder()
  const headers = { 'Content-Type': 'text/event-stream' }
  const connection = fetchServerSentEvents('http://agent.test/run', {
    fetch: (_url, init) => {
      const input = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as RunAgentInput
      requests.push(input)
      if (requests.length > 1) {
        const events = then(input, requests.length - 1)
        const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
        return Promise.resolve(new Response(body, { headers }))
      }
      const started = { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(started)}\n\n`))
          init.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('The run was aborted.', 'AbortError'))
          })
        },
      })
      return Promise.resolve(new Response(stream, { headers }))
    },
  })
  return { connection, requests }
}

describe('editing a message', () => {
  it('replaces the last user message and runs it as a new turn, with its own context', async () => {
    const backend = scriptedBackend(says('First.'), says('Second.'))
    const client = new ChatClient({ connection: backend.connection })
    await client.sendMessage('Hi')
    const selected = { description: 'Text the user selected', value: '"A-7"' }

    await client.editMessage(userMessageId(client, 0), 'Hello', { context: [selected] })

    expect(client.getMessages().map(message => message.parts)).toEqual([
      [{ type: 'text', content: 'Hello' }],
      [{ type: 'text', content: 'Second.' }],
    ])
    expect(backend.requests[1]?.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Hello' }),
    ])
    expect(backend.requests[1]?.context).toEqual([selected])
    expect(client.getStatus()).toBe('ready')
  })

  it('sends an edit with its own options, not those of the message it replaced, and reloads it so', async () => {
    const backend = scriptedBackend(says('First.'), says('Second.'), says('Third.'))
    const client = new ChatClient({ connection: backend.connection })
    const original = { description: 'Original', value: '1' }
    const edited = { description: 'Edited', value: '2' }
    await client.sendMessage('Hi', { context: [original], forwardedProps: { a: 1 } })

    await client.editMessage(userMessageId(client, 0), 'Hello', { context: [edited] })
    await client.reload()

    expect(backend.requests.slice(1).map(request => request.context)).toEqual([[edited], [edited]])
    expect(backend.requests.slice(1).map(request => request.forwardedProps as unknown)).toEqual([
      {},
      {},
    ])
  })

  it('drops every turn after an earlier message it edits', async () => {
    const backend = scriptedBackend(says('One.'), says('Two.'), says('Three.'), says('Edited.'))
    const client = new ChatClient({ connection: backend.connection })
    await client.sendMessage('First')
    await client.sendMessage('Second')
    await client.sendMessage('Third')

    await client.editMessage(userMessageId(client, 1), 'Second, edited')

    expect(client.getHistory().map(message => message.content)).toEqual([
      'First',
      'One.',
      'Second, edited',
      'Edited.',
    ])
    expect(backend.requests[3]?.messages.map(message => message.content)).toEqual([
      'First',
      'One.',
      'Second, edited',
    ])
  })

  it('stops the run in flight, then runs the edited message', async () => {
    const backend = streamsUntilAborted(says('Edited.'))
    const client = new ChatClient({ connection: backend.connection })

    const turn = client.sendMessage('Hi')
    await vi.waitFor(() => {
      expect(client.getStatus()).toBe('streaming')
    })
    await client.editMessage(userMessageId(client, 0), 'Hello')
    await turn

    expect(backend.requests).toHaveLength(2)
    expect(backend.requests[1]?.messages.map(message => message.content)).toEqual(['Hello'])
    expect(client.getHistory().map(message => message.content)).toEqual(['Hello', 'Edited.'])
    expect(client.getError()).toBeUndefined()
    expect(client.getStatus()).toBe('ready')
  })

  it('keeps the late result of a tool from a dropped turn out of the history and the next run', async () => {
    const backend = scriptedBackend(calls(acknowledge), says('Edited.'))
    let release: (value: unknown) => void = () => undefined
    let signal: AbortSignal | undefined
    const execute = vi.fn(
      (_input: unknown, context: ToolExecutionContext) =>
        new Promise(resolve => {
          signal = context.signal
          release = resolve
        }),
    )
    const client = new ChatClient({ connection: backend.connection, tools: [tool(execute)] })

    const turn = client.sendMessage('Acknowledge A-7')
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce()
    })
    const edit = client.editMessage(userMessageId(client, 0), 'What is A-7?')
    expect(signal?.aborted).toBe(true)
    release({ acknowledged: true })
    await Promise.all([turn, edit])

    expect(execute).toHaveBeenCalledOnce()
    expect(backend.requests[1]?.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'What is A-7?' }),
    ])
    expect(client.getHistory().map(message => message.role)).toEqual(['user', 'assistant'])
    expect(toolCalls(client)).toEqual([])
  })

  it('resumes as cancelled the backend’s question from a dropped turn, so the next run is accepted', async () => {
    const shutIn = { id: 'call-9', name: 'shut_in_well', args: { wellId: 'W-1' } }
    const approval = { id: 'approval-9', reason: 'tool_call', toolCallId: 'call-9' }
    const backend = scriptedBackend(interrupts([shutIn], approval), says('Which well?'))
    const client = new ChatClient({ connection: backend.connection })

    const turn = client.sendMessage('Shut in W-1')
    await nextInterrupt(client)
    await client.editMessage(userMessageId(client, 0), 'Shut in W-2')
    await turn

    expect(client.getError()).toBeUndefined()
    expect(client.getInterrupts()).toEqual([])
    expect(backend.requests[1]).toMatchObject({
      parentRunId: backend.requests[0]?.runId,
      resume: [{ interruptId: 'approval-9', status: 'cancelled' }],
    })
    expect(backend.requests[1]?.messages.map(message => message.content)).toEqual(['Shut in W-2'])
    expect(toolCalls(client)).toEqual([])
  })

  it('owes the backend nothing from a dropped turn: its answer is resumed as cancelled', async () => {
    const show = { id: 'call-2', name: 'show_summary', args: { title: 'A-7' } }
    const raised = { id: 'client_tool_call-2', reason: 'tool_call', toolCallId: 'call-2' }
    const backend = scriptedBackend(interrupts([show], raised), says('Anything else?'))
    const summary: ChatTool = {
      name: 'show_summary',
      description: 'Show a summary card',
      followUp: false,
      execute: () => ({ shown: true }),
    }
    const client = new ChatClient({ connection: backend.connection, tools: [summary] })
    await client.sendMessage('Summarise A-7')

    await client.editMessage(userMessageId(client, 0), 'Summarise A-8')

    expect(client.getError()).toBeUndefined()
    expect(backend.requests[1]?.resume).toEqual([
      { interruptId: 'client_tool_call-2', status: 'cancelled' },
    ])
    expect(backend.requests[1]?.messages.map(message => message.role)).toEqual(['user'])
  })

  it('does nothing for an id that is not a user message, or an empty text', async () => {
    const backend = scriptedBackend(says('Hello.'))
    const client = new ChatClient({ connection: backend.connection })
    await client.sendMessage('Hi')
    const answer = client.getHistory()[1]?.id ?? ''

    await client.editMessage(answer, 'Hello')
    await client.editMessage('no-such-message', 'Hello')
    await client.editMessage(userMessageId(client, 0), '  ')

    expect(backend.requests).toHaveLength(1)
    expect(client.getHistory().map(message => message.content)).toEqual(['Hi', 'Hello.'])
  })
})

describe('what a run sends of the conversation', () => {
  /** `turns` earlier turns, each with a query whose result is `size` characters and reasoning. */
  function earlier(turns: number, size: number): Message[] {
    return Array.from({ length: turns }, (_, index): Message[] => {
      const n = String(index)
      return [
        { id: `u${n}`, role: 'user', content: `Question ${n}` },
        { id: `r${n}`, role: 'reasoning', content: 'Thinking it over.' },
        {
          id: `a${n}`,
          role: 'assistant',
          toolCalls: [
            { id: `c${n}`, type: 'function', function: { name: 'query_wells', arguments: '{}' } },
          ],
        },
        { id: `t${n}`, role: 'tool', toolCallId: `c${n}`, content: 'x'.repeat(size) },
        { id: `m${n}`, role: 'assistant', content: `Answer ${n}` },
      ]
    }).flat()
  }

  const sentContent = (request: RunAgentInput | undefined, id: string) =>
    request?.messages.find(message => message.id === id)?.content

  it('shortens old tool results and drops old reasoning, and the transcript keeps them', async () => {
    const backend = scriptedBackend(says('Done.'))
    const initialMessages = earlier(8, 12_345)
    const client = new ChatClient({ connection: backend.connection, initialMessages })

    await client.sendMessage('And now?')

    const [request] = backend.requests
    // The new turn and the five before it go whole; the three before those are shortened.
    expect(sentContent(request, 't2')).toBe(
      '[Result omitted from this request: 12,345 characters. Call the tool again if it is needed.]',
    )
    expect(sentContent(request, 't3')).toHaveLength(12_345)
    expect(sentContent(request, 'r2')).toBeUndefined()
    expect(sentContent(request, 'r3')).toBe('Thinking it over.')
    const callIds = request?.messages.flatMap(message =>
      message.role === 'assistant' ? (message.toolCalls ?? []).map(call => call.id) : [],
    )
    const resultIds = request?.messages.flatMap(message =>
      message.role === 'tool' ? [message.toolCallId] : [],
    )
    expect(resultIds).toEqual(callIds)
    expect(callIds).toHaveLength(8)

    expect(client.getHistory().slice(0, 40)).toEqual(initialMessages)
    const outputs = toolCalls(client).map(part => part.output)
    expect(outputs).toEqual(Array.from({ length: 8 }, () => 'x'.repeat(12_345)))
    expect(
      client.getMessages().filter(message => message.parts[0]?.type === 'thinking'),
    ).toHaveLength(8)
  })

  it('takes the limits from the history option, and from updateOptions', async () => {
    const backend = scriptedBackend(says('Done.'))
    const client = new ChatClient({
      connection: backend.connection,
      initialMessages: earlier(3, 500),
      history: { keepTurns: 2, maxToolResultChars: 100 },
    })

    await client.sendMessage('And now?')
    client.updateOptions({ history: false })
    await client.sendMessage('And then?')

    expect(sentContent(backend.requests[0], 't1')).toMatch(/^\[Result omitted/)
    expect(sentContent(backend.requests[0], 't2')).toHaveLength(500)
    expect(backend.requests[1]?.messages).toHaveLength(client.getHistory().length - 1)
    expect(sentContent(backend.requests[1], 't0')).toHaveLength(500)
  })

  it.each([
    ['history: false', false as const],
    ['keepTurns: Infinity', { keepTurns: Infinity }],
  ])('sends the whole conversation with %s', async (_, history) => {
    const backend = scriptedBackend(says('Done.'))
    const initialMessages = earlier(10, 5000)
    const client = new ChatClient({ connection: backend.connection, initialMessages, history })

    await client.sendMessage('And now?')

    expect(backend.requests[0]?.messages.slice(0, -1)).toEqual(initialMessages)
  })

  it('sends what a history function returns, given the whole conversation', async () => {
    const backend = scriptedBackend(says('Done.'))
    const initialMessages = earlier(10, 5000)
    const history = vi.fn((messages: readonly Message[]) => messages.slice(-1))
    const client = new ChatClient({ connection: backend.connection, initialMessages, history })

    await client.sendMessage('And now?')

    expect(history).toHaveBeenCalledOnce()
    expect(history.mock.calls[0]?.[0]).toHaveLength(51)
    expect(backend.requests[0]?.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'And now?' }),
    ])
    expect(client.getHistory()).toHaveLength(52)
  })

  it('fails the turn when the history function throws, instead of rejecting', async () => {
    const backend = scriptedBackend(says('Done.'))
    const onError = vi.fn()
    const client = new ChatClient({
      connection: backend.connection,
      onError,
      history: () => {
        throw new Error('Bad history')
      },
    })

    await client.sendMessage('Hi')

    expect(backend.requests).toHaveLength(0)
    expect(client.getStatus()).toBe('error')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Bad history' }))
  })

  it('still resumes a backend’s question, which names the interrupt and not the messages', async () => {
    const shutIn = { id: 'call-9', name: 'shut_in_well', args: { wellId: 'W-1' } }
    const approval = { id: 'approval-9', reason: 'tool_call', toolCallId: 'call-9' }
    const backend = scriptedBackend(interrupts([shutIn], approval), says('Done.'))
    const client = new ChatClient({
      connection: backend.connection,
      initialMessages: earlier(8, 5000),
    })

    const turn = client.sendMessage('Shut in W-1')
    const interrupt = await nextInterrupt(client)
    if (interrupt.kind === 'tool-approval') interrupt.resolveInterrupt(true)
    await turn

    expect(client.getError()).toBeUndefined()
    expect(backend.requests[1]?.resume).toEqual([
      expect.objectContaining({ interruptId: 'approval-9', status: 'resolved' }),
    ])
    expect(sentContent(backend.requests[1], 't2')).toMatch(/^\[Result omitted/)
    expect(backend.requests[1]?.messages.at(-1)).toMatchObject({ toolCalls: [{ id: 'call-9' }] })
  })
})
