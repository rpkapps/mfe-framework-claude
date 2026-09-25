/**
 * The development agent backend: `POST /agent` takes an AG-UI `RunAgentInput` and streams the
 * run back as server-sent events, which is AG-UI's HTTP binding and all the shell's chat speaks
 * (docs/decisions.md §49). `pnpm dev` starts it beside the dev API.
 *
 * With `AGENT_DEV_OPENAI_URL` and `AGENT_DEV_MODEL` set it talks to that OpenAI-compatible server,
 * a local model included; with `ANTHROPIC_API_KEY` and `AGENT_DEV_MODEL`, to Anthropic's API;
 * otherwise it runs the demo agent, a script that needs neither a key nor the network.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'

import type { AGUIEvent, RunAgentInput } from '@ag-ui/core'

import { anthropicModel } from './anthropic-model.ts'
import { demoModel } from './demo-model.ts'
import { openAiModel } from './openai-model.ts'
import { runError, type Model } from './events.ts'
import { DEV_AGENT_PORT } from './port.ts'

function set(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

/** An OpenAI-compatible server first, then Anthropic, then the demo agent. */
export function modelFromEnvironment(): { readonly model: Model; readonly name: string } {
  const model = set('AGENT_DEV_MODEL')
  const baseUrl = set('AGENT_DEV_OPENAI_URL')
  if (baseUrl !== undefined && model !== undefined) {
    const apiKey = set('AGENT_DEV_API_KEY')
    return {
      model: openAiModel({ baseUrl, model, ...(apiKey === undefined ? {} : { apiKey }) }),
      name: `${model} at ${baseUrl}`,
    }
  }
  const apiKey = set('ANTHROPIC_API_KEY')
  if (apiKey !== undefined && model !== undefined) {
    return { model: anthropicModel({ apiKey, model }), name: model }
  }
  return { model: demoModel(), name: 'the demo agent' }
}

/**
 * The shell is another origin in development, and its Authorization header makes every run
 * preflighted; whatever headers its fetch adds are allowed.
 */
function cors(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader(
    'Access-Control-Allow-Headers',
    request.headers['access-control-request-headers'] ?? 'Authorization, Content-Type, Accept',
  )
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Max-Age', '600')
}

/** More than any conversation the shell sends; a body past it is refused, not buffered. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

async function readBody(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arrayOf(value: unknown, item: (entry: Record<string, unknown>) => boolean): boolean {
  return value === undefined || (Array.isArray(value) && value.every(e => isObject(e) && item(e)))
}

const ROLES = new Set(['user', 'assistant', 'system', 'developer', 'tool', 'reasoning', 'activity'])

/**
 * A `RunAgentInput`, checked as far as the models read it: ids, messages with a role, tools with a
 * name, context entries with text. `tools` and `context` may be left out, as the spec allows.
 */
export function readInput(body: string): RunAgentInput | undefined {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return undefined
  }
  if (
    !isObject(value) ||
    typeof value['threadId'] !== 'string' ||
    typeof value['runId'] !== 'string' ||
    !Array.isArray(value['messages']) ||
    !arrayOf(
      value['messages'],
      message => typeof message['id'] === 'string' && ROLES.has(message['role'] as string),
    ) ||
    !arrayOf(
      value['tools'],
      tool => typeof tool['name'] === 'string' && typeof tool['description'] === 'string',
    ) ||
    !arrayOf(
      value['context'],
      entry => typeof entry['description'] === 'string' && typeof entry['value'] === 'string',
    ) ||
    !arrayOf(value['resume'], entry => typeof entry['interruptId'] === 'string')
  ) {
    return undefined
  }
  const input = value as Partial<RunAgentInput> &
    Pick<RunAgentInput, 'threadId' | 'runId' | 'messages'>
  return {
    ...input,
    tools: input.tools ?? [],
    context: input.context ?? [],
    state: (input.state as unknown) ?? null,
    forwardedProps: (input.forwardedProps as unknown) ?? {},
  }
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

/** Streams one run; the model is stopped as soon as the client goes away. */
async function run(
  model: Model,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readBody(request)
  if (body === undefined) {
    sendJson(response, 413, { error: `The body is over ${String(MAX_BODY_BYTES)} bytes.` })
    return
  }
  const input = readInput(body)
  if (input === undefined) {
    sendJson(response, 400, { error: 'The body is not an AG-UI RunAgentInput.' })
    return
  }

  const controller = new AbortController()
  response.on('close', () => {
    controller.abort()
  })
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // `no-transform` keeps a compressing proxy from holding the stream back.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })
  response.flushHeaders()
  const send = (event: AGUIEvent): void => {
    if (!controller.signal.aborted) response.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  try {
    for await (const event of model(input, controller.signal)) {
      if (controller.signal.aborted) break
      send(event)
    }
  } catch (error) {
    // A model stopped because the client went away throws; there is no one to tell.
    send(runError(error instanceof Error ? error.message : String(error)))
  }
  response.end()
}

export function createAgentServer(model: Model) {
  return createServer((request, response) => {
    cors(request, response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== '/agent') {
      sendJson(response, 404, { error: 'POST an AG-UI RunAgentInput to /agent.' })
      return
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS')
      sendJson(response, 405, { error: 'POST an AG-UI RunAgentInput to /agent.' })
      return
    }

    run(model, request, response).catch(() => {
      // The request broke off while its body was read: there is no one to answer.
      response.destroy()
    })
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { model, name } = modelFromEnvironment()
  createAgentServer(model).listen(DEV_AGENT_PORT, () => {
    process.stdout.write(
      `Agent backend on http://localhost:${String(DEV_AGENT_PORT)}/agent, with ${name}.\n`,
    )
  })
}
