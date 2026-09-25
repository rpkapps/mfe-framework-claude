import type { AddressInfo } from 'node:net'

import { ChatClient, fetchServerSentEvents, type ChatTool } from '@company/mfe-agent'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { demoModel } from './demo-model.ts'
import { createAgentServer } from './server.ts'

const server = createAgentServer(demoModel({ delayMs: 0 }))
let url = ''

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, resolve))
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/agent`
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

describe('the development agent, through the shell’s chat client', () => {
  it('calls a page tool, gets its result and says what it means', async () => {
    const execute = vi.fn(() => ({ status: 'executed', value: { acknowledged: true } }))
    const acknowledge: ChatTool = {
      name: 'operations__acknowledge-alert',
      description: 'Stop an alert paging the on-call engineer.',
      inputSchema: {
        type: 'object',
        properties: { alertId: { type: 'string' } },
        required: ['alertId'],
      },
      execute,
    }
    const chat = new ChatClient({ connection: fetchServerSentEvents(url), tools: [acknowledge] })

    await chat.sendMessage('Acknowledge alert A-7')

    expect(execute).toHaveBeenCalledWith({ alertId: 'A-7' }, expect.anything())
    expect(chat.getMessages().at(-1)?.parts.at(-1)).toEqual({
      type: 'text',
      content: 'Done: {"acknowledged":true}.',
    })
    expect(chat.getError()).toBeUndefined()
  })

  it('asks for approval of its own tool through an interrupt, and resumes with the answer', async () => {
    const chat = new ChatClient({ connection: fetchServerSentEvents(url) })

    const turn = chat.sendMessage('Shut in W-3')
    await vi.waitFor(() => {
      expect(chat.getInterrupts()).toHaveLength(1)
    })
    const [interrupt] = chat.getInterrupts()
    expect(interrupt).toMatchObject({
      kind: 'tool-approval',
      source: 'backend',
      toolName: 'shut_in_well',
      originalArgs: { wellId: 'W-3' },
    })
    if (interrupt?.kind === 'tool-approval') interrupt.resolveInterrupt(true)
    await turn

    const text = chat
      .getMessages()
      .flatMap(message => message.parts)
      .flatMap(part => (part.type === 'text' ? [part.content] : []))
    expect(text.at(-1)).toBe('W-3 is shut in. (The development agent only pretends.)')
  })

  it('refuses a body that is not a run', async () => {
    const response = await fetch(url, { method: 'POST', body: '{}' })
    expect(response.status).toBe(400)
  })
})
