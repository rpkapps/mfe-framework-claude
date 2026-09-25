/**
 * The spike's questions, each answered by a test (docs/agentic-plan.md, E):
 * 1. A page action called by a backend agent runs through the action pipeline and its result
 *    reaches the agent.
 * 2. Approval happens once, and which step drives the card: the pipeline's for a page action,
 *    the backend's interrupt for a backend tool.
 * 3. The chat works against a backend that is not TanStack AI.
 * 4. Which client library: the plain AG-UI client, or TanStack AI's.
 */

import { toolDefinition } from '@tanstack/ai'
import { ChatClient, fetchServerSentEvents } from '@tanstack/ai-client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAgUiChat, type BackendApproval } from './ag-ui-chat.ts'
import { createOperationsPage, type OperationsPage } from './page.ts'
import { createSpecBackend } from './servers/spec-backend.ts'
import { createTanStackBackend } from './servers/tanstack-backend.ts'

let page: OperationsPage | undefined

afterEach(() => {
  page?.dispose()
  page = undefined
})

function openPage(): OperationsPage {
  page = createOperationsPage()
  return page
}

function lastText(messages: readonly { role: string; content?: unknown }[]): string {
  const answer = messages.findLast(
    message => message.role === 'assistant' && typeof message.content === 'string',
  )
  return typeof answer?.content === 'string' ? answer.content : ''
}

const neverAsked = (): Promise<boolean> =>
  Promise.reject(new Error('No backend tool was expected.'))

describe('the plain AG-UI client against a TanStack AI backend', () => {
  it('runs a page action through the pipeline, asks the user once, and returns its result', async () => {
    const { memory, acknowledged, asked } = openPage()
    const backend = createTanStackBackend()
    const chat = createAgUiChat({
      ...backend,
      runtime: memory.runtime,
      approveBackendTool: neverAsked,
    })

    const steps = await chat.send('please acknowledge the alert')

    expect(acknowledged).toEqual(['A-7'])
    expect(asked.map(request => request.actionId)).toEqual(['operations:acknowledge-alert'])
    expect(steps.filter(step => step.kind === 'page-tool' || step.kind === 'error')).toEqual([
      { kind: 'page-tool', tool: 'operations__acknowledge-alert', status: 'executed' },
    ])
    expect(lastText(chat.messages)).toContain('"acknowledged":true')
  })

  it('records the agent, the chat thread and the run in the audit', async () => {
    const { memory } = openPage()
    const backend = createTanStackBackend()
    const chat = createAgUiChat({
      ...backend,
      runtime: memory.runtime,
      approveBackendTool: neverAsked,
    })

    const steps = await chat.send('please acknowledge the alert')

    const firstRun = steps.find(step => step.kind === 'run')
    expect(memory.telemetry.frameworkRecords('run action')).toMatchObject([
      {
        attributes: {
          'action.id': 'operations:acknowledge-alert',
          'action.actor': 'agent',
          'action.outcome': 'executed',
          'chat.turn_id': firstRun?.kind === 'run' ? firstRun.runId : 'missing',
        },
      },
    ])
  })

  it('tells the agent the user declined, and never runs the action', async () => {
    const { memory, acknowledged, answerApprovals } = openPage()
    answerApprovals(false)
    const backend = createTanStackBackend()
    const chat = createAgUiChat({
      ...backend,
      runtime: memory.runtime,
      approveBackendTool: neverAsked,
    })

    await chat.send('please acknowledge the alert')

    expect(acknowledged).toEqual([])
    expect(lastText(chat.messages)).toContain('"status":"declined"')
  })

  it('sends the agent-placed actions as tools, with names a model accepts', async () => {
    const { memory } = openPage()
    const backend = createTanStackBackend()
    const chat = createAgUiChat({
      ...backend,
      runtime: memory.runtime,
      approveBackendTool: neverAsked,
    })

    await chat.send('hello')

    const [first] = backend.requests
    expect(first?.tools.map(tool => tool.name)).toEqual([
      'operations__acknowledge-alert',
      'operations__read-well',
    ])
    expect(first?.tools[0]?.parameters).toMatchObject({
      type: 'object',
      properties: { alertId: { type: 'string', description: 'The alert, such as A-7' } },
      required: ['alertId'],
    })
  })

  it('sends where the user is and what they selected as AG-UI context', async () => {
    const { memory } = openPage()
    const backend = createTanStackBackend()
    const chat = createAgUiChat({
      ...backend,
      runtime: memory.runtime,
      approveBackendTool: neverAsked,
    })

    await chat.send('hello')

    const context = backend.requests[0]?.context ?? []
    expect(context.map(entry => entry.description)).toEqual([
      'Where the user is: the page URL, and each App it is inside with its own path',
      'The alerts the user has selected',
    ])
    expect(JSON.parse(context[0]?.value ?? '{}')).toEqual({
      url: { pathname: '/operations/alerts', search: { severity: 'high' } },
      apps: [{ definitionId: 'operations', basePath: '/operations', path: '/alerts' }],
    })
    expect(JSON.parse(context[1]?.value ?? '{}')).toMatchObject({ value: { ids: ['A-7'] } })
  })

  it('answers a call whose mount has gone as unavailable, and never runs it', async () => {
    const { memory, acknowledged, unmount } = openPage()
    const backend = createTanStackBackend()
    const fetch = async (url: string, init: RequestInit): Promise<Response> => {
      const response = await backend.fetch(url, init)
      // The App unmounts after the tools were sent, while the agent is deciding.
      unmount()
      return response
    }
    const chat = createAgUiChat({
      ...backend,
      fetch,
      runtime: memory.runtime,
      approveBackendTool: neverAsked,
    })

    const steps = await chat.send('please acknowledge the alert')

    expect(acknowledged).toEqual([])
    expect(steps.filter(step => step.kind === 'page-tool' || step.kind === 'error')).toEqual([
      { kind: 'page-tool', tool: 'operations__acknowledge-alert', status: 'unavailable' },
    ])
    // The run that answers still declares the tool, or the backend refuses the answer.
    expect(backend.requests.at(-1)?.tools.map(tool => tool.name)).toEqual([
      'operations__acknowledge-alert',
    ])
    expect(lastText(chat.messages)).toContain('"status":"unavailable"')
  })

  it.each([
    [true, ['W-1']],
    [false, []],
  ])(
    'asks about a backend tool through its interrupt, and resumes it with the answer (approved: %s)',
    async (approved, shutIn) => {
      const { memory, asked } = openPage()
      const backend = createTanStackBackend()
      const shown: BackendApproval[] = []
      const chat = createAgUiChat({
        ...backend,
        runtime: memory.runtime,
        approveBackendTool: approval => {
          shown.push(approval)
          return Promise.resolve(approved)
        },
      })

      const steps = await chat.send('shut in W-1')

      expect(shown).toEqual([
        expect.objectContaining({ toolName: 'shut_in_well', input: { wellId: 'W-1' } }),
      ])
      expect(asked).toEqual([])
      expect(backend.shutIn).toEqual(shutIn)
      expect(steps.filter(step => step.kind === 'error')).toEqual([])
    },
  )

  it('needs RUN_STARTED moved to the front of a resumed run: TanStack AI 0.58 sends it second', async () => {
    const { memory } = openPage()
    const backend = createTanStackBackend({ runStartedFirst: false })
    const chat = createAgUiChat({
      ...backend,
      runtime: memory.runtime,
      approveBackendTool: () => Promise.resolve(true),
    })

    const steps = await chat.send('shut in W-1')

    // The approved tool ran; the strict client refused the run that reported it.
    expect(backend.shutIn).toEqual(['W-1'])
    expect(steps).toContainEqual({ kind: 'error', message: "First event must be 'RUN_STARTED'" })
  })
})

describe('against a backend that speaks only the spec', () => {
  it('the plain AG-UI client runs the page action and continues the run', async () => {
    const { memory, acknowledged } = openPage()
    const backend = createSpecBackend()
    const chat = createAgUiChat({
      ...backend,
      runtime: memory.runtime,
      approveBackendTool: neverAsked,
    })

    await chat.send('please acknowledge the alert')

    expect(acknowledged).toEqual(['A-7'])
    expect(backend.requests.at(-1)?.messages.at(-1)).toMatchObject({ role: 'tool' })
    expect(lastText(chat.messages)).toContain('"acknowledged":true')
  })

  it('TanStack AI’s client leaves the call pending and never sends the page’s context', async () => {
    const backend = createSpecBackend()
    const execute = vi.fn(() => ({ acknowledged: true }))
    const client = new ChatClient({
      connection: fetchServerSentEvents(backend.url, {
        fetchClient: (_input, init) => backend.fetch(backend.url, init ?? {}),
      }),
      tools: [
        toolDefinition({
          name: 'operations__acknowledge-alert',
          description: 'Acknowledge an alert',
          inputSchema: { type: 'object', properties: { alertId: { type: 'string' } } },
        }).client(execute),
      ],
    })

    await client.sendMessage('please acknowledge the alert')
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(execute).not.toHaveBeenCalled()
    expect(backend.requests).toHaveLength(1)
    expect(backend.requests[0]?.context).toEqual([])
    const call = client
      .getMessages()
      .flatMap(message => message.parts)
      .find(part => part.type === 'tool-call')
    expect(call).toMatchObject({ state: 'input-complete' })
  })
})

describe('TanStack AI’s client against its own backend', () => {
  it('runs a page tool natively, as an interrupt it answers with a resume', async () => {
    const backend = createTanStackBackend()
    const execute = vi.fn(() => ({ acknowledged: true }))
    const client = new ChatClient({
      connection: fetchServerSentEvents(backend.url, {
        fetchClient: (_input, init) => backend.fetch(backend.url, init ?? {}),
      }),
      tools: [
        toolDefinition({
          name: 'operations__acknowledge-alert',
          description: 'Acknowledge an alert',
          inputSchema: { type: 'object', properties: { alertId: { type: 'string' } } },
        }).client(execute),
      ],
    })

    await client.sendMessage('please acknowledge the alert')

    await vi.waitFor(() => {
      expect(backend.requests).toHaveLength(2)
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(backend.requests[1]?.resume).toEqual([
      expect.objectContaining({
        interruptId: expect.stringMatching(/^client_tool_/) as string,
        status: 'resolved',
      }),
    ])
  })
})

/**
 * Against a running Agent Framework backend (`dotnet/`): `AGENT_SPIKE_DOTNET_URL` names it, such
 * as http://127.0.0.1:5087/agent. Not run in CI, which has no .NET.
 */
const dotnet = process.env['AGENT_SPIKE_DOTNET_URL']

describe.skipIf(dotnet === undefined)(
  'the plain AG-UI client against Agent Framework (.NET)',
  () => {
    const url = dotnet ?? ''

    it('runs a page action through the pipeline and continues the run', async () => {
      const { memory, acknowledged, asked } = openPage()
      const chat = createAgUiChat({ url, runtime: memory.runtime, approveBackendTool: neverAsked })

      await chat.send('please acknowledge the alert')

      expect(acknowledged).toEqual(['A-7'])
      expect(asked).toHaveLength(1)
      expect(lastText(chat.messages)).toContain('acknowledged')
    })

    it.each([true, false])(
      'resumes its own approval interrupt when the page declares no tools (approved: %s)',
      async approved => {
        const { memory, unmount } = openPage()
        unmount()
        const chat = createAgUiChat({
          url,
          runtime: memory.runtime,
          approveBackendTool: () => Promise.resolve(approved),
        })

        const steps = await chat.send('shut in W-1')

        expect(steps).toContainEqual({ kind: 'approval', tool: 'shut_in_well', approved })
        expect(lastText(chat.messages)).toContain(approved ? 'shut-in' : 'rejected')
      },
    )

    it('raises no interrupt for its own tool once the page declares tools (a known gap)', async () => {
      const { memory } = openPage()
      const chat = createAgUiChat({ url, runtime: memory.runtime, approveBackendTool: neverAsked })

      const steps = await chat.send('shut in W-1')

      expect(steps).toContainEqual({ kind: 'left-pending', tool: 'shut_in_well' })
    })
  },
)
