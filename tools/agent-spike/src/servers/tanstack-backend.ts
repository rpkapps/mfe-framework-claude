/**
 * A backend on TanStack AI's `chat()`, as a team would write one: it declares the page's tools from
 * each request (`mergeAgentTools`), owns one domain tool that needs approval, and answers in
 * AG-UI over server-sent events. In process, so the spike needs no port: the chat calls `fetch`.
 */

import type { RunAgentInput } from '@ag-ui/core'
import {
  chat,
  chatParamsFromRequestBody,
  mergeAgentTools,
  toolDefinition,
  toServerSentEventsResponse,
} from '@tanstack/ai'

import { operationsScript, ScriptedModel, type Script } from './scripted-model.ts'

export interface TanStackBackend {
  readonly url: string
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  /** Every request, as the backend received it. */
  readonly requests: readonly RunAgentInput[]
  /** The domain tool's runs: what the backend did with the user's approval. */
  readonly shutIn: readonly string[]
}

export interface TanStackBackendOptions {
  readonly script?: Script
  /**
   * Moves `RUN_STARTED` to the front of a run, which the AG-UI spec requires and a strict client
   * enforces. TanStack AI opens the run that resumes an approved tool with that tool's result, before
   * `RUN_STARTED`; its own client does not mind. On by default; off shows the raw stream.
   */
  readonly runStartedFirst?: boolean
}

/** Holds back whatever comes before `RUN_STARTED` until it has been sent. */
async function* runStartedFirst<Event extends { readonly type: string }>(
  events: AsyncIterable<Event>,
): AsyncIterable<Event> {
  let early: Event[] | undefined = []
  for await (const event of events) {
    if (early === undefined) {
      yield event
    } else if (event.type === 'RUN_STARTED') {
      const held: Event[] = early
      early = undefined
      yield event
      yield* held
    } else {
      early.push(event)
    }
  }
  // A stream that never started is passed on as it came.
  if (early !== undefined) yield* early
}

export function createTanStackBackend(options: TanStackBackendOptions = {}): TanStackBackend {
  const requests: RunAgentInput[] = []
  const shutIn: string[] = []
  const model = new ScriptedModel(options.script ?? operationsScript)

  const shutInWell = toolDefinition({
    name: 'shut_in_well',
    description: 'Shut in a well. A domain tool: it runs on this backend.',
    inputSchema: {
      type: 'object',
      properties: { wellId: { type: 'string' } },
      required: ['wellId'],
    },
    needsApproval: true,
  }).server(input => {
    const { wellId } = input as { wellId: string }
    shutIn.push(wellId)
    return { wellId, status: 'shut-in' }
  })

  async function handle(body: RunAgentInput): Promise<Response> {
    requests.push(body)
    const params = await chatParamsFromRequestBody(body)
    const stream = chat({
      adapter: model,
      messages: params.messages,
      tools: mergeAgentTools([shutInWell], params.tools),
      threadId: params.threadId,
      runId: params.runId,
      ...(params.parentRunId === undefined ? {} : { parentRunId: params.parentRunId }),
      ...(params.resume === undefined ? {} : { resume: params.resume }),
    })
    return toServerSentEventsResponse(
      options.runStartedFirst === false ? stream : runStartedFirst(stream),
    )
  }

  return {
    url: 'http://tanstack.test/agent',
    fetch: (_url, init) =>
      handle(JSON.parse(typeof init.body === 'string' ? init.body : '{}') as RunAgentInput),
    requests,
    shutIn,
  }
}
