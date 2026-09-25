import type { Message, RunAgentInput, Tool } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { decide, exampleOf } from './demo-model.ts'

const acknowledge: Tool = {
  name: 'operations__acknowledge-alert',
  description: 'Stop an alert paging the on-call engineer.',
  parameters: {
    type: 'object',
    properties: { alertId: { type: 'string' }, note: { type: 'string' } },
    required: ['alertId'],
  },
}

const navigate: Tool = {
  name: 'navigate',
  description: 'Go to a page.',
  parameters: {
    type: 'object',
    properties: {
      app: { type: 'string', enum: ['operations', 'insights'] },
      path: { type: 'string' },
    },
  },
}

function input(
  messages: Message[],
  tools: Tool[] = [],
  extra: Partial<RunAgentInput> = {},
): RunAgentInput {
  return {
    threadId: 't',
    runId: 'r1',
    state: null,
    messages,
    tools,
    context: [],
    forwardedProps: {},
    ...extra,
  }
}

const user = (content: string): Message => ({ id: 'u', role: 'user', content })

describe('decide', () => {
  it('calls the page action a request names, with the id it mentions', () => {
    expect(decide(input([user('Acknowledge alert A-7')], [acknowledge]))).toEqual([
      { call: { name: 'operations__acknowledge-alert', args: { alertId: 'A-7' } } },
    ])
  })

  it('navigates to the App a request names', () => {
    expect(decide(input([user('Take me to insights')], [navigate]))).toEqual([
      { say: 'Taking you to insights.' },
      { call: { name: 'navigate', args: { app: 'insights', path: '/' } } },
    ])
  })

  it('matches whole words: an App inside a longer word is not named, a plural is', () => {
    const toOps: Tool = {
      ...navigate,
      parameters: {
        type: 'object',
        properties: { app: { type: 'string', enum: ['ops', 'well-design'] } },
      },
    }
    expect(decide(input([user('Go to the page that stops the pump')], [toOps]))).not.toContainEqual(
      expect.objectContaining({ call: expect.anything() as unknown }),
    )
    expect(decide(input([user('Open well design')], [toOps]))).toContainEqual({
      call: { name: 'navigate', args: { app: 'well-design', path: '/' } },
    })
    expect(decide(input([user('Acknowledge the alerts')], [acknowledge]))).toEqual([
      { call: { name: 'operations__acknowledge-alert', args: { alertId: '' } } },
    ])
  })

  it('does not take a word every request has for the action it means', () => {
    const showLog: Tool = {
      name: 'wells__show-log',
      description: 'Show the log of a well.',
      parameters: { type: 'object' },
    }
    expect(decide(input([user('Show me what you can do')], [showLog]))).toEqual([
      { say: expect.stringContaining('development agent') as unknown },
    ])
  })

  it('answers help, a greeting and a bare question mark with what it can do', () => {
    for (const message of ['help', 'Hi there', '?', '']) {
      expect(decide(input([user(message)], [acknowledge])), message).toEqual([
        { say: expect.stringContaining('AGENT_DEV_OPENAI_URL') as unknown },
      ])
    }
  })

  it('asks for tools it was not given by name, and carries on once it has them', () => {
    const discover: Tool = {
      name: 'discover_tools',
      description: 'More tools.',
      parameters: {
        type: 'object',
        properties: {
          names: { type: 'array', items: { type: 'string', enum: [acknowledge.name] } },
        },
      },
    }
    expect(decide(input([user('Acknowledge alert A-7')], [discover]))).toEqual([
      { call: { name: 'discover_tools', args: { names: [acknowledge.name] } } },
    ])

    const found = decide(
      input(
        [
          user('Acknowledge alert A-7'),
          {
            id: 'a',
            role: 'assistant',
            toolCalls: [
              { id: 'c1', type: 'function', function: { name: 'discover_tools', arguments: '{}' } },
            ],
          },
          { id: 'tm', role: 'tool', toolCallId: 'c1', content: '{"tools":[]}' },
        ],
        [acknowledge, discover],
      ),
    )
    expect(found).toEqual([
      { call: { name: 'operations__acknowledge-alert', args: { alertId: 'A-7' } } },
    ])
  })

  it('says what a page tool’s result means', () => {
    const history: Message[] = [
      user('Acknowledge alert A-7'),
      {
        id: 'a',
        role: 'assistant',
        toolCalls: [
          { id: 'c1', type: 'function', function: { name: acknowledge.name, arguments: '{}' } },
        ],
      },
      { id: 'tm', role: 'tool', toolCallId: 'c1', content: '{"status":"declined","reason":"No"}' },
    ]
    expect(decide(input(history, [acknowledge]))).toEqual([
      { say: 'You declined, so I left it as it was.' },
    ])
  })

  it('asks for approval of its own tool, and acts on the answer', () => {
    const asked = decide(input([user('Shut in W-12')]))
    expect(asked[1]).toEqual({
      backendCall: {
        id: 'call_shut_in_r1',
        args: { wellId: 'W-12' },
        message: expect.stringContaining('W-12') as unknown,
      },
    })

    const history: Message[] = [
      user('Shut in W-12'),
      {
        id: 'a',
        role: 'assistant',
        toolCalls: [
          {
            id: 'call_shut_in_r1',
            type: 'function',
            function: { name: 'shut_in_well', arguments: '{"wellId":"W-12"}' },
          },
        ],
      },
    ]
    const resumed = decide(
      input(history, [], {
        resume: [
          {
            interruptId: 'approval_call_shut_in_r1',
            status: 'resolved',
            payload: { approved: true },
          },
        ],
      }),
    )
    expect(resumed[0]).toEqual({
      backendResult: {
        toolCallId: 'call_shut_in_r1',
        content: { status: 'shut-in', wellId: 'W-12' },
      },
    })
  })
})

describe('exampleOf', () => {
  it('fills the required fields from defaults, enums and types', () => {
    expect(
      exampleOf({
        type: 'object',
        properties: {
          wellId: { type: 'string', enum: ['w-1', 'w-2'] },
          compare: { type: 'array' },
          showActions: { type: 'boolean', default: true },
          depth: { type: 'number', minimum: 100 },
          note: { type: 'string' },
        },
        required: ['wellId', 'compare', 'showActions', 'depth'],
      }),
    ).toEqual({ wellId: 'w-1', compare: [], showActions: true, depth: 100 })
  })
})

describe('the A2UI path', () => {
  const a2ui: Tool = {
    name: 'render_a2ui',
    description: 'Show UI.',
    parameters: { type: 'object' },
  }

  it('shows a form, and answers the action its button sends', () => {
    const [, shown] = decide(input([user('show a form')], [a2ui]))
    expect(shown).toMatchObject({
      call: { name: 'render_a2ui', args: { surfaceId: 'handover_r1' } },
    })

    const answered = decide(
      input([user('Hand over')], [a2ui], {
        forwardedProps: {
          a2uiAction: { userAction: { name: 'hand_over', context: { note: 'x' } } },
        },
      }),
    )
    expect(answered).toEqual([{ say: 'Got "hand_over" with {"note":"x"}.' }])
  })
})
