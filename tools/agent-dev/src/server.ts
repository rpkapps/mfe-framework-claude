/**
 * The development agent backend: `POST /agent` takes an AG-UI `RunAgentInput` and streams the
 * run back as server-sent events, which is AG-UI's HTTP binding and all the shell's chat speaks
 * (docs/decisions.md §49). `pnpm dev` starts it beside the dev API.
 *
 * With `AGENT_DEV_OPENAI_URL` and `AGENT_DEV_MODEL` set it talks to that OpenAI-compatible server,
 * a local model included; with `ANTHROPIC_API_KEY` and `AGENT_DEV_MODEL`, to Anthropic's API;
 * otherwise it runs the demo agent, a script that needs neither a key nor the network. Those can be
 * kept in `tools/agent-dev/.env` (git-ignored; `.env.example` lists them); a variable set in the
 * shell wins over the file.
 */

import { existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { AGUIEvent, RunAgentInput } from '@ag-ui/core'

import { anthropicModel } from './anthropic-model.ts'
import { demoModel } from './demo-model.ts'
import { openAiModel } from './openai-model.ts'
import { runError, type Model } from './events.ts'
import { DEV_AGENT_HOST, DEV_AGENT_PORT } from './port.ts'

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
 * The key or the local model behind this server is the developer's, so only a page on this machine
 * may run it: the shell, on loopback, whatever port it was given. Any other page in the
 * developer's browser is refused before its body is read, not only denied the answer, since a
 * plain-text POST needs no preflight. A request with no Origin is not a page's (curl, a test).
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/

export function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === undefined || LOOPBACK_ORIGIN.test(origin)
}

/**
 * The shell is another origin in development, and its Authorization header makes every run
 * preflighted; whatever headers its fetch adds are allowed. Only an allowed origin gets here.
 */
function cors(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Vary', 'Origin')
  const origin = request.headers.origin
  if (origin === undefined) return
  response.setHeader('Access-Control-Allow-Origin', origin)
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
    const origin = request.headers.origin
    if (!isAllowedOrigin(origin)) {
      sendJson(response, 403, {
        error: `Only a page on this machine may run the development agent, and ${String(origin)} is not one. Open the shell on localhost.`,
      })
      return
    }
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

/** The package's `.env`, when there is one: Node reads it, and leaves a variable already set alone. */
export function loadEnvFile(path = fileURLToPath(new URL('../.env', import.meta.url))): boolean {
  if (!existsSync(path)) return false
  process.loadEnvFile(path)
  return true
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const fromFile = loadEnvFile()
  const { model, name } = modelFromEnvironment()
  // Loopback only: on every interface, anyone on the network could run it.
  createAgentServer(model).listen(DEV_AGENT_PORT, DEV_AGENT_HOST, () => {
    process.stdout.write(
      `Agent backend on http://localhost:${String(DEV_AGENT_PORT)}/agent, with ${name}${fromFile ? ' (tools/agent-dev/.env read)' : ''}.\n`,
    )
  })
}
