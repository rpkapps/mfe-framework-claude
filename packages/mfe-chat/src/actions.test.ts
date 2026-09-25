import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createMemoryRuntime, type MemoryRuntime } from '@company/mfe-runtime/testing'

import { calls, says, scriptedBackend } from './__tests__/backend.ts'
import { actionTools, agentContextOf, approvalsIn, toolNameOf } from './actions.ts'
import { ChatClient } from './chat-client.ts'

const owner = {
  definitionId: 'operations',
  mountToken: 'mount-1',
  kind: 'app',
  basePath: '/operations',
} as const

let current: MemoryRuntime | undefined

afterEach(() => {
  current?.dispose()
  current = undefined
})

function page() {
  const memory = createMemoryRuntime({ initialEntries: ['/operations/alerts?severity=high'] })
  current = memory
  const { runtime } = memory
  const acknowledged: string[] = []
  runtime.actions.register(owner, {
    name: 'acknowledge-alert',
    label: 'Acknowledge alert',
    description: 'Stop an alert paging the on-call engineer.',
    effect: 'write',
    needsApproval: true,
    inputSchema: z.object({ alertId: z.string() }),
    execute: ({ alertId }) => {
      acknowledged.push(alertId)
      return { acknowledged: true }
    },
  })
  runtime.actions.register(owner, {
    name: 'copy-link',
    label: 'Copy link',
    placements: ['palette'],
    execute: () => undefined,
  })
  return { memory, runtime, acknowledged }
}

describe('toolNameOf', () => {
  it('writes an action id as a name model APIs accept', () => {
    expect(toolNameOf('operations:acknowledge-alert')).toBe('operations__acknowledge-alert')
    expect(toolNameOf('host:open.panel')).toBe('host__open_panel')
    expect(toolNameOf(`a:${'x'.repeat(80)}`)).toHaveLength(64)
  })
})

describe('actionTools', () => {
  it('offers the actions placed for the agent, with their descriptions and schemas', () => {
    const { runtime } = page()

    expect(
      actionTools(runtime.actions).map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    ).toEqual([
      {
        name: 'operations__acknowledge-alert',
        description: 'Stop an alert paging the on-call engineer.',
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: { alertId: { type: 'string' } },
        }) as unknown,
      },
    ])
  })

  it('runs a call through the pipeline as the agent’s, with the chat turn in the audit', async () => {
    const { memory, runtime, acknowledged } = page()
    runtime.actions.setApprover(() => Promise.resolve(true))
    const [tool] = actionTools(runtime.actions)

    const result = await tool?.execute(
      { alertId: 'A-7' },
      { toolCallId: 'call-1', threadId: 'thread-1', runId: 'run-4' },
    )

    expect(result).toEqual({ status: 'executed', value: { acknowledged: true } })
    expect(acknowledged).toEqual(['A-7'])
    expect(memory.telemetry.frameworkRecords('run action')).toMatchObject([
      {
        attributes: {
          'action.actor': 'agent',
          'chat.thread_id': 'thread-1',
          'chat.turn_id': 'run-4',
        },
      },
    ])
  })

  it('tells the agent what the pipeline refused, and what went away', async () => {
    const { runtime } = page()
    runtime.actions.setApprover(() => Promise.resolve(false))
    const [tool] = actionTools(runtime.actions)
    const context = { toolCallId: 'call-1', threadId: 't', runId: 'r' }

    expect(await tool?.execute({ alertId: 'A-7' }, context)).toMatchObject({ status: 'declined' })
    expect(await tool?.execute({ alertId: 7 }, context)).toMatchObject({ status: 'invalid' })

    runtime.actions.removeMount(owner.mountToken)
    expect(await tool?.execute({ alertId: 'A-7' }, context)).toMatchObject({
      status: 'unavailable',
      error: { code: 'action/unavailable' },
    })
  })
})

describe('approvalsIn', () => {
  it('asks the pipeline’s question through the chat, on the call the agent made', async () => {
    const { runtime, acknowledged } = page()
    const backend = scriptedBackend(
      calls({ id: 'call-1', name: 'operations__acknowledge-alert', args: { alertId: 'A-7' } }),
      says('Done.'),
    )
    const chat = new ChatClient({
      connection: backend.connection,
      tools: () => actionTools(runtime.actions),
    })
    runtime.actions.setApprover(approvalsIn(chat.requestApproval))

    const turn = chat.sendMessage('Acknowledge A-7')
    await expect.poll(() => chat.getInterrupts()).toHaveLength(1)
    const [card] = chat.getInterrupts()
    expect(card).toMatchObject({
      source: 'page',
      toolCallId: 'call-1',
      label: 'Acknowledge alert',
      description: 'Stop an alert paging the on-call engineer.',
      originalArgs: { alertId: 'A-7' },
    })
    if (card?.kind === 'tool-approval') card.resolveInterrupt(true)
    await turn

    expect(acknowledged).toEqual(['A-7'])
  })
})

describe('agentContextOf', () => {
  it('says where the user is and what they selected', () => {
    const { runtime } = page()
    runtime.agentContext.trackBoundary(owner)
    runtime.agentContext.register(owner, {
      description: 'The alerts the user selected',
      schema: z.object({ ids: z.array(z.string()) }),
      value: { ids: ['A-7'] },
    })

    const [where, selection] = agentContextOf(runtime.agentContext)

    expect(JSON.parse(where?.value ?? '')).toEqual({
      url: { pathname: '/operations/alerts', search: { severity: 'high' } },
      apps: [{ definitionId: 'operations', basePath: '/operations', path: '/alerts' }],
    })
    expect(selection?.description).toBe('The alerts the user selected')
    expect(JSON.parse(selection?.value ?? '')).toMatchObject({
      definitionId: 'operations',
      value: { ids: ['A-7'] },
    })
  })
})
