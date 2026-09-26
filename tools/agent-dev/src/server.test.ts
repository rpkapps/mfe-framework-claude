import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EventType, type AGUIEvent } from '@ag-ui/core'

import { ChatClient, fetchServerSentEvents, type ChatTool } from '@company/mfe-agent'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { demoModel } from './demo-model.ts'
import type { Model } from './events.ts'
import {
  createAgentServer,
  isAllowedOrigin,
  loadEnvFile,
  MAX_BODY_BYTES,
  readInput,
} from './server.ts'

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

const run = { threadId: 't', runId: 'r', messages: [{ id: 'u', role: 'user', content: 'Hi' }] }

describe('readInput', () => {
  it('takes a run without tools or context, as the spec allows', () => {
    expect(readInput(JSON.stringify(run))).toMatchObject({ tools: [], context: [], state: null })
  })

  it('refuses what the models could not read', () => {
    for (const body of [
      'not json',
      '[]',
      JSON.stringify({ ...run, messages: undefined }),
      JSON.stringify({ ...run, messages: [null] }),
      JSON.stringify({ ...run, messages: [{ id: 'u', role: 'robot' }] }),
      JSON.stringify({ ...run, tools: [{ name: 'a' }] }),
      JSON.stringify({ ...run, context: [{ description: 'x', value: 1 }] }),
      JSON.stringify({ ...run, resume: 'yes' }),
    ]) {
      expect(readInput(body), body).toBeUndefined()
    }
  })
})

describe('the development agent over HTTP', () => {
  /** A server of its own, for a test's own model. */
  async function serving(model: Model): Promise<{ url: string; close: () => Promise<void> }> {
    const own = createAgentServer(model)
    await new Promise<void>(resolve => own.listen(0, resolve))
    return {
      url: `http://127.0.0.1:${String((own.address() as AddressInfo).port)}`,
      close: () =>
        new Promise(resolve => {
          own.closeAllConnections()
          own.close(() => {
            resolve()
          })
        }),
    }
  }

  it('answers a preflight with the headers the page asked for, and other methods with 405', async () => {
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,traceparent',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toBe(
      'authorization,content-type,traceparent',
    )
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')

    expect((await fetch(url)).status).toBe(405)
    expect((await fetch(url.replace(/\/agent$/, '/other'), { method: 'POST' })).status).toBe(404)
  })

  it('is run by a page on this machine only, and never for another page', async () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:5173', 'http://[::1]:3000']) {
      expect(isAllowedOrigin(origin), origin).toBe(true)
    }
    for (const origin of [
      'https://evil.example',
      'http://localhost.evil.example',
      'http://192.168.1.20:3000',
      'null',
    ]) {
      expect(isAllowedOrigin(origin), origin).toBe(false)
    }

    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    })
    expect(preflight.status).toBe(403)
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()

    const model = vi.fn(demoModel({ delayMs: 0 }))
    const { url: base, close } = await serving(model)
    try {
      // A plain-text POST is sent without a preflight: it must not reach the model either.
      const response = await fetch(`${base}/agent`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
        body: JSON.stringify(run),
      })
      expect(response.status).toBe(403)
      expect(model).not.toHaveBeenCalled()
    } finally {
      await close()
    }
  })

  it('refuses a body over the limit', async () => {
    const response = await fetch(url, { method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) })
    expect(response.status).toBe(413)
  })

  it('stops the model when the client goes away', async () => {
    let stopped = false
    const waiting: Model = async function* (input, signal) {
      yield { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId }
      await new Promise<void>(resolve => {
        signal.addEventListener('abort', () => {
          stopped = true
          resolve()
        })
      })
      yield { type: EventType.RUN_ERROR, message: 'never sent' } satisfies AGUIEvent
    }
    const { url: base, close } = await serving(waiting)
    try {
      const client = new AbortController()
      const response = await fetch(`${base}/agent`, {
        method: 'POST',
        body: JSON.stringify(run),
        signal: client.signal,
      })
      const reader = (response.body as ReadableStream<Uint8Array>).getReader()
      const first = new TextDecoder().decode((await reader.read()).value)
      expect(first).toContain('RUN_STARTED')
      client.abort()
      await vi.waitFor(() => {
        expect(stopped).toBe(true)
      })
    } finally {
      await close()
    }
  })

  it('survives a request that breaks off while its body is sent', async () => {
    const { url: base, close } = await serving(demoModel({ delayMs: 0 }))
    try {
      await new Promise<void>(resolve => {
        const request = httpRequest(`${base}/agent`, {
          method: 'POST',
          headers: { 'content-length': '1000' },
        })
        request.on('error', () => {
          resolve()
        })
        request.write('{"threadId":')
        setTimeout(() => {
          request.destroy()
        }, 20)
      })
      const response = await fetch(`${base}/agent`, { method: 'POST', body: JSON.stringify(run) })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('RUN_FINISHED')
    } finally {
      await close()
    }
  })
})

describe('loadEnvFile', () => {
  it('reads the package’s .env, leaving a variable the shell set alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-dev-env-'))
    const path = join(dir, '.env')
    writeFileSync(path, 'AGENT_DEV_TEST_FROM_FILE=file\nAGENT_DEV_TEST_SET=file\n')
    process.env['AGENT_DEV_TEST_SET'] = 'shell'
    try {
      expect(loadEnvFile(path)).toBe(true)
      expect(process.env['AGENT_DEV_TEST_FROM_FILE']).toBe('file')
      expect(process.env['AGENT_DEV_TEST_SET']).toBe('shell')
      expect(loadEnvFile(join(dir, 'missing.env'))).toBe(false)
    } finally {
      delete process.env['AGENT_DEV_TEST_FROM_FILE']
      delete process.env['AGENT_DEV_TEST_SET']
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
