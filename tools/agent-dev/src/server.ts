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

import type { RunAgentInput } from '@ag-ui/core'

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

/** The shell is another origin in development, and its Authorization header makes every run preflighted. */
function cors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Max-Age', '600')
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Enough of `RunAgentInput` to run: the shell always sends the rest. */
function readInput(body: string): RunAgentInput | undefined {
  try {
    const value = JSON.parse(body) as Partial<RunAgentInput>
    if (typeof value.threadId !== 'string' || typeof value.runId !== 'string') return undefined
    return {
      ...value,
      threadId: value.threadId,
      runId: value.runId,
      messages: Array.isArray(value.messages) ? value.messages : [],
      tools: Array.isArray(value.tools) ? value.tools : [],
      context: Array.isArray(value.context) ? value.context : [],
      state: (value.state as unknown) ?? null,
      forwardedProps: (value.forwardedProps as unknown) ?? {},
    }
  } catch {
    return undefined
  }
}

export function createAgentServer(model: Model) {
  return createServer((request, response) => {
    cors(response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method !== 'POST' || url.pathname !== '/agent') {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'POST an AG-UI RunAgentInput to /agent.' }))
      return
    }

    void (async () => {
      const input = readInput(await readBody(request))
      if (input === undefined) {
        response.writeHead(400, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'The body is not an AG-UI RunAgentInput.' }))
        return
      }

      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        // `no-transform` keeps a compressing proxy from holding the stream back.
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })
      const controller = new AbortController()
      response.on('close', () => {
        controller.abort()
      })
      try {
        for await (const event of model(input, controller.signal)) {
          response.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        response.write(`data: ${JSON.stringify(runError(message))}\n\n`)
      }
      response.end()
    })()
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
