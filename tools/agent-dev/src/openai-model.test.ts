import type { AddressInfo } from 'node:net'

import { EventType, type AGUIEvent, type RunAgentInput } from '@ag-ui/core'
import { ChatClient, fetchServerSentEvents, type ChatTool } from '@company/mfe-agent'
import { describe, expect, it, vi } from 'vitest'

import { completionsUrl, openAiModel, ThinkSplitter, toChatMessages } from './openai-model.ts'
import { createAgentServer } from './server.ts'

function input(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: 't',
    runId: 'r1',
    state: null,
    forwardedProps: {},
    context: [],
    tools: [],
    messages: [{ id: 'u1', role: 'user', content: 'Hi' }],
    ...overrides,
  }
}

/** A chat completions stream, as vLLM or Ollama send it. */
function stream(chunks: readonly object[], done = true): Response {
  const body = [
    ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`),
    done ? 'data: [DONE]\n\n' : '',
  ].join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

const delta = (value: object): object => ({ choices: [{ index: 0, delta: value }] })

async function events(model: ReturnType<typeof openAiModel>, run = input()): Promise<AGUIEvent[]> {
  const out: AGUIEvent[] = []
  for await (const event of model(run, new AbortController().signal)) out.push(event)
  return out
}

describe('toChatMessages', () => {
  it('writes the history as chat messages, the context in the system prompt, reasoning left out', () => {
    const messages = toChatMessages(
      input({
        context: [{ description: 'Where the user is', value: '{"url":"/ops"}' }],
        messages: [
          { id: 'u1', role: 'user', content: 'Acknowledge A-7' },
          { id: 'r', role: 'reasoning', content: 'The user wants…' },
          {
            id: 'a1',
            role: 'assistant',
            toolCalls: [{ id: 'c1', type: 'function', function: { name: 'ack', arguments: '' } }],
          },
          { id: 't1', role: 'tool', toolCallId: 'c1', content: '{"ok":true}' },
        ],
      }),
    )

    expect(messages[0]).toMatchObject({ role: 'system' })
    expect(messages[0]?.content).toContain('- Where the user is: {"url":"/ops"}')
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'Acknowledge A-7' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ack', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    ])
  })

  it('posts to the completions path of a base URL, and keeps a full one', () => {
    expect(completionsUrl('http://10.0.0.5:8000/v1/')).toBe(
      'http://10.0.0.5:8000/v1/chat/completions',
    )
    expect(completionsUrl('http://h/v1/chat/completions')).toBe('http://h/v1/chat/completions')
  })
})

describe('ThinkSplitter', () => {
  it('splits inline <think> reasoning from the text, however the tags are cut', () => {
    const splitter = new ThinkSplitter()
    const pieces = ['<thi', 'nk>Plan: ack', ' it</th', 'ink>Done', '.', ' <'].flatMap(part =>
      splitter.push(part),
    )
    pieces.push(...splitter.flush())

    const joined = (kind: string) =>
      pieces
        .filter(piece => piece.kind === kind)
        .map(piece => piece.text)
        .join('')
    expect(joined('reasoning')).toBe('Plan: ack it')
    expect(joined('text')).toBe('Done. <')
  })
})

describe('openAiModel', () => {
  it('streams reasoning, text and tool calls as AG-UI, leaving the calls pending', async () => {
    let sent: Record<string, unknown> = {}
    const model = openAiModel({
      baseUrl: 'http://gpu.lan:8000/v1',
      model: 'deepseek',
      apiKey: 'k',
      fetch: (url, init) => {
        sent = { url, headers: init?.headers, ...(JSON.parse(init?.body as string) as object) }
        return Promise.resolve(
          stream([
            delta({ role: 'assistant', reasoning_content: 'Needs the ' }),
            delta({ reasoning_content: 'ack tool.' }),
            delta({ content: 'On it.' }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  type: 'function',
                  function: { name: 'ack', arguments: '' },
                },
              ],
            }),
            delta({ tool_calls: [{ index: 0, function: { arguments: '{"id":' } }] }),
            delta({ tool_calls: [{ index: 0, function: { arguments: '"A-7"}' } }] }),
            delta({
              tool_calls: [
                { index: 1, id: 'call_b', function: { name: 'navigate', arguments: '{}' } },
              ],
            }),
            { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
          ]),
        )
      },
    })

    const out = await events(
      model,
      input({ tools: [{ name: 'ack', description: 'Ack', parameters: { type: 'object' } }] }),
    )

    expect(sent).toMatchObject({
      url: 'http://gpu.lan:8000/v1/chat/completions',
      headers: { authorization: 'Bearer k' },
      model: 'deepseek',
      stream: true,
      tools: [{ type: 'function', function: { name: 'ack', parameters: { type: 'object' } } }],
    })
    expect(out.map(event => event.type)).toEqual([
      'RUN_STARTED',
      'REASONING_START',
      'REASONING_MESSAGE_START',
      'REASONING_MESSAGE_CONTENT',
      'REASONING_MESSAGE_CONTENT',
      'REASONING_MESSAGE_END',
      'REASONING_END',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'RUN_FINISHED',
    ])
    expect(out.at(-1)).toMatchObject({
      outcome: { type: 'success', pendingToolCallIds: ['call_a', 'call_b'] },
    })
  })

  it('sends no tools key without tools, and names calls a server left unnamed', async () => {
    let body: Record<string, unknown> = {}
    const model = openAiModel({
      baseUrl: 'http://h/v1',
      model: 'm',
      fetch: (_url, init) => {
        body = JSON.parse(init?.body as string) as Record<string, unknown>
        return Promise.resolve(
          stream(
            [
              delta({ tool_calls: [{ index: 0, function: { name: 'a', arguments: '{}' } }] }),
              // Numbered 0 again, with an id of its own: a second call.
              delta({
                tool_calls: [{ index: 0, id: 'x2', function: { name: 'b', arguments: '{}' } }],
              }),
            ],
            false,
          ),
        )
      },
    })

    const out = await events(model)

    expect(body).not.toHaveProperty('tools')
    expect(out.at(-1)).toMatchObject({ outcome: { pendingToolCallIds: ['call_r1_0', 'x2'] } })
  })

  it('reports a refused request, an error in the stream and an unreachable server as run errors', async () => {
    const refused = openAiModel({
      baseUrl: 'http://h/v1',
      model: 'm',
      fetch: () => Promise.resolve(new Response('no such model', { status: 404 })),
    })
    expect((await events(refused)).at(-1)).toMatchObject({
      type: 'RUN_ERROR',
      message: 'The model answered 404: no such model',
    })

    const failing = openAiModel({
      baseUrl: 'http://h/v1',
      model: 'm',
      fetch: () => Promise.resolve(stream([{ error: { message: 'out of memory' } }])),
    })
    expect((await events(failing)).at(-1)).toMatchObject({
      type: 'RUN_ERROR',
      message: 'out of memory',
    })

    const away = openAiModel({
      baseUrl: 'http://h/v1',
      model: 'm',
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    })
    expect((await events(away)).at(-1)).toMatchObject({
      type: 'RUN_ERROR',
      message: expect.stringContaining('ECONNREFUSED') as unknown,
    })
  })
})

describe('openAiModel, when the stream is not clean', () => {
  const run = (response: Response | (() => Response)) =>
    events(
      openAiModel({
        baseUrl: 'http://h/v1',
        model: 'm',
        fetch: () => Promise.resolve(typeof response === 'function' ? response() : response),
      }),
    )

  it('closes what is open before RUN_FINISHED when a stream ends mid-reply', async () => {
    const out = await run(stream([delta({ content: '<think>Hmm' })], false))
    expect(out.map(event => event.type)).toEqual([
      'RUN_STARTED',
      'REASONING_START',
      'REASONING_MESSAGE_START',
      'REASONING_MESSAGE_CONTENT',
      'REASONING_MESSAGE_END',
      'REASONING_END',
      'RUN_FINISHED',
    ])
  })

  it('skips a payload that is not JSON, and reads CRLF streams', async () => {
    const body = [
      'data: {not json\r\n\r\n',
      `data: ${JSON.stringify(delta({ content: 'Hi' }))}\r\n\r\n`,
    ]
    const out = await run(new Response(body.join('')))
    expect(out.filter(event => event.type === EventType.TEXT_MESSAGE_CONTENT)).toMatchObject([
      { delta: 'Hi' },
    ])
    expect(out.at(-1)?.type).toBe('RUN_FINISHED')
  })

  it('takes an empty id on a later piece as the same call', async () => {
    const out = await run(
      stream([
        delta({
          tool_calls: [{ index: 0, id: 'c1', function: { name: 'ack', arguments: '{"a"' } }],
        }),
        delta({ tool_calls: [{ index: 0, id: '', function: { arguments: ':1}' } }] }),
      ]),
    )
    expect(out.filter(event => event.type === EventType.TOOL_CALL_ARGS)).toMatchObject([
      { toolCallId: 'c1', delta: '{"a"' },
      { toolCallId: 'c1', delta: ':1}' },
    ])
    expect(out.at(-1)).toMatchObject({ outcome: { pendingToolCallIds: ['c1'] } })
  })

  it('reports a stream that breaks off as a run error', async () => {
    const encoder = new TextEncoder()
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(delta({ content: 'Hi' }))}\n\n`))
        controller.error(new Error('socket hang up'))
      },
    })
    const out = await run(new Response(broken))
    expect(out.at(-1)).toMatchObject({
      type: 'RUN_ERROR',
      message: expect.stringContaining('socket hang up') as unknown,
    })
  })

  it('sends nothing more once the client has gone', async () => {
    const controller = new AbortController()
    const model = openAiModel({
      baseUrl: 'http://h/v1',
      model: 'm',
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          const abort = () => {
            reject(new DOMException('aborted', 'AbortError'))
          }
          if (init?.signal?.aborted === true) abort()
          init?.signal?.addEventListener('abort', abort)
        }),
    })
    const out: AGUIEvent[] = []
    for await (const event of model(input(), controller.signal)) {
      out.push(event)
      controller.abort()
    }
    expect(out.map(event => event.type)).toEqual(['RUN_STARTED'])
  })
})

describe('a local model, through the shell’s chat client', () => {
  it('shows the thinking, runs the page tool it calls, and answers with its result', async () => {
    const replies = [
      stream([
        delta({ content: '<think>The user wants an ack.</think>' }),
        delta({
          tool_calls: [
            { index: 0, id: 'call_1', function: { name: 'ack', arguments: '{"id":"A-7"}' } },
          ],
        }),
      ]),
      stream([delta({ content: 'Acknowledged A-7.' })]),
    ]
    const upstream = vi.fn(() => Promise.resolve(replies.shift() ?? stream([])))
    const server = createAgentServer(
      openAiModel({ baseUrl: 'http://gpu.lan/v1', model: 'm', fetch: upstream }),
    )
    await new Promise<void>(resolve => server.listen(0, resolve))
    const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/agent`

    const execute = vi.fn(() => ({ status: 'executed' }))
    const ack: ChatTool = { name: 'ack', description: 'Acknowledge an alert', execute }
    const chat = new ChatClient({ connection: fetchServerSentEvents(url), tools: [ack] })
    try {
      await chat.sendMessage('Ack A-7')
    } finally {
      await new Promise(resolve => server.close(resolve))
    }

    expect(chat.getError()).toBeUndefined()
    expect(execute).toHaveBeenCalledWith({ id: 'A-7' }, expect.anything())
    const parts = chat.getMessages().flatMap(message => message.parts)
    expect(parts).toContainEqual({ type: 'thinking', content: 'The user wants an ack.' })
    expect(parts.at(-1)).toEqual({ type: 'text', content: 'Acknowledged A-7.' })
    // The second request carried the tool's answer and not the thinking.
    const second = JSON.parse(
      (upstream.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    ) as {
      messages: { role: string }[]
    }
    expect(second.messages.map(message => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ])
  })
})
