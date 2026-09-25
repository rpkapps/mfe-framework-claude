import { describe, expect, it, vi } from 'vitest'

import { calls, fails, interrupts, says, scriptedBackend } from './__tests__/backend.ts'
import { ChatClient } from './chat-client.ts'
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

  it('leaves a call it does not own to the backend, and ends the turn', async () => {
    const backend = scriptedBackend(
      calls({ id: 'call-9', name: 'shut_in_well', args: { wellId: 'W-1' } }),
    )
    const client = new ChatClient({ connection: backend.connection, tools: [tool()] })

    await client.sendMessage('Shut in W-1')

    expect(backend.requests).toHaveLength(1)
    expect(toolCalls(client)[0]).toMatchObject({ name: 'shut_in_well', state: 'input-complete' })
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
})
