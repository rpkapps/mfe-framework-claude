import type { AGUIEvent, RunAgentInput } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { anthropicModel, toAnthropic } from './anthropic-model.ts'

const input: RunAgentInput = {
  threadId: 't',
  runId: 'r1',
  state: null,
  forwardedProps: {},
  context: [{ description: 'Where the user is', value: '{"url":"/operations"}' }],
  tools: [{ name: 'navigate', description: 'Go somewhere.', parameters: { type: 'object' } }],
  messages: [
    { id: 'u1', role: 'user', content: 'Acknowledge A-7' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'On it.',
      toolCalls: [
        { id: 'c1', type: 'function', function: { name: 'ack', arguments: '{"id":"A-7"}' } },
        { id: 'c2', type: 'function', function: { name: 'note', arguments: '' } },
      ],
    },
    { id: 't1', role: 'tool', toolCallId: 'c1', content: '{"ok":true}' },
    { id: 't2', role: 'tool', toolCallId: 'c2', content: 'boom', error: 'boom' },
    { id: 'u2', role: 'user', content: 'Thanks' },
  ],
}

describe('toAnthropic', () => {
  it('puts the context in the system prompt and tool results in one user turn', () => {
    const { system, messages } = toAnthropic(input)

    expect(system).toContain('- Where the user is: {"url":"/operations"}')
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Acknowledge A-7' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', id: 'c1', name: 'ack', input: { id: 'A-7' } },
          { type: 'tool_use', id: 'c2', name: 'note', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}' },
          { type: 'tool_result', tool_use_id: 'c2', content: 'boom', is_error: true },
          { type: 'text', text: 'Thanks' },
        ],
      },
    ])
  })
})

function stream(events: readonly unknown[]): Response {
  const body = events.map(event => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

describe('anthropicModel', () => {
  it('streams text and tool calls as AG-UI, and leaves the calls pending for the page', async () => {
    let sent: Record<string, unknown> = {}
    const model = anthropicModel({
      apiKey: 'key',
      model: 'test-model',
      fetch: (_url, init) => {
        sent = JSON.parse(init?.body as string) as Record<string, unknown>
        return Promise.resolve(
          stream([
            { type: 'message_start', message: { id: 'm1' } },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Going.' },
            },
            { type: 'content_block_stop', index: 0 },
            {
              type: 'content_block_start',
              index: 1,
              content_block: { type: 'tool_use', id: 'tu1', name: 'navigate', input: {} },
            },
            {
              type: 'content_block_delta',
              index: 1,
              delta: { type: 'input_json_delta', partial_json: '{"app":"ops"}' },
            },
            { type: 'content_block_stop', index: 1 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
            { type: 'message_stop' },
          ]),
        )
      },
    })

    const events: AGUIEvent[] = []
    for await (const event of model(input, new AbortController().signal)) events.push(event)

    expect(sent).toMatchObject({
      model: 'test-model',
      stream: true,
      tools: [{ name: 'navigate', input_schema: { type: 'object' } }],
    })
    expect(events.map(event => event.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'RUN_FINISHED',
    ])
    expect(events.at(-1)).toMatchObject({
      outcome: { type: 'success', pendingToolCallIds: ['tu1'] },
    })
  })

  it('reports a refused request as a run error', async () => {
    const model = anthropicModel({
      apiKey: 'key',
      model: 'test-model',
      fetch: () => Promise.resolve(new Response('bad key', { status: 401 })),
    })
    const events: AGUIEvent[] = []
    for await (const event of model(input, new AbortController().signal)) events.push(event)
    expect(events.at(-1)).toMatchObject({
      type: 'RUN_ERROR',
      message: expect.stringContaining('401') as unknown,
    })
  })
})
