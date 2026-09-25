/**
 * The chat on the plain AG-UI client: what the shell's chat module would be if E takes
 * `@ag-ui/client`. One user turn is as many runs as it takes: a run that stops on a page tool is
 * answered through the action pipeline and continued; a run that stops on a backend's approval
 * shows the card and is resumed with the answer.
 */

import { HttpAgent } from '@ag-ui/client'
import type { Interrupt, Message, ResumeEntry, Tool, ToolCall } from '@ag-ui/core'
import type { MfeRuntime } from '@company/mfe-react'

import {
  approvalResume,
  listPageTools,
  runPageTool,
  turnContext,
  type ChatTurn,
} from './page-tools.ts'

/** A backend (domain) tool the agent wants to run, as the card shows it. */
export interface BackendApproval {
  readonly toolName: string
  readonly input: unknown
  readonly message?: string
}

export interface AgUiChatOptions {
  readonly url: string
  /** In-process backends are called through this; a real one over the network. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  readonly runtime: MfeRuntime
  /** The card for a backend tool: resolves whether the user approved. */
  readonly approveBackendTool: (approval: BackendApproval) => Promise<boolean>
}

/** What happened in a turn, in order, for the spike's assertions. */
export type ChatStep =
  | { readonly kind: 'run'; readonly runId: string; readonly outcome: string }
  | { readonly kind: 'page-tool'; readonly tool: string; readonly status: string }
  | { readonly kind: 'approval'; readonly tool: string; readonly approved: boolean }
  | { readonly kind: 'left-pending'; readonly tool: string }
  | { readonly kind: 'error'; readonly message: string }

export interface AgUiChat {
  send(text: string): Promise<readonly ChatStep[]>
  readonly messages: readonly Message[]
}

/** A turn that keeps asking is stopped, so a script that loops cannot hang the spike. */
const MAX_RUNS_PER_TURN = 8

/** TanStack AI's convention for a page tool: the run ends on an interrupt, not a pending call. */
function isTanStackClientTool(interrupt: Interrupt): boolean {
  return interrupt.metadata?.['kind'] === 'client_tool'
}

export function createAgUiChat(options: AgUiChatOptions): AgUiChat {
  const agent = new HttpAgent({
    url: options.url,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })

  // A resume names the run it continues. TanStack AI refuses a resume without it; the spec allows
  // it and Agent Framework ignores it.
  let lastRunId: string | undefined
  agent.use((input, next) =>
    next.run(
      input.resume === undefined || lastRunId === undefined
        ? input
        : { ...input, parentRunId: lastRunId },
    ),
  )

  const callsById = (): Map<string, ToolCall> =>
    new Map(
      agent.messages.flatMap(message =>
        message.role === 'assistant' ? (message.toolCalls ?? []).map(call => [call.id, call]) : [],
      ),
    )

  async function answerPageTool(
    call: ToolCall,
    turn: ChatTurn,
    steps: ChatStep[],
  ): Promise<unknown> {
    const result = await runPageTool(options.runtime, call, turn)
    steps.push({ kind: 'page-tool', tool: call.function.name, status: result.status })
    agent.addMessage({
      id: crypto.randomUUID(),
      role: 'tool',
      toolCallId: call.id,
      content: JSON.stringify(result),
    })
    return result
  }

  async function send(text: string): Promise<readonly ChatStep[]> {
    const steps: ChatStep[] = []
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text })
    let resume: ResumeEntry[] | undefined
    // The tools a run answering calls must still declare, though their mount may have gone: both
    // backends recognise a page tool's result, or its interrupt, by the tools the run declares.
    let answering: readonly Tool[] = []

    for (let run = 0; run < MAX_RUNS_PER_TURN; run += 1) {
      const pageTools = listPageTools(options.runtime)
      const declared = [
        ...pageTools.tools,
        ...answering.filter(tool => pageTools.actionIdOf(tool.name) === undefined),
      ]
      let finished:
        | { outcome: 'success'; pendingToolCallIds: string[]; runId: string }
        | { outcome: 'interrupt'; interrupts: Interrupt[]; runId: string }
        | { outcome: 'cancelled' | 'error'; runId: string }
        | undefined

      await agent
        .runAgent(
          {
            tools: declared,
            context: turnContext(options.runtime),
            ...(resume === undefined ? {} : { resume }),
          },
          {
            onRunFinishedEvent: params => {
              lastRunId = params.event.runId
              finished =
                params.outcome === 'success'
                  ? { ...params, runId: params.event.runId }
                  : params.outcome === 'interrupt'
                    ? { ...params, runId: params.event.runId }
                    : { outcome: 'cancelled', runId: params.event.runId }
            },
            onRunErrorEvent: params => {
              steps.push({ kind: 'error', message: params.event.message })
            },
          },
        )
        .catch((error: unknown) => {
          steps.push({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        })

      if (finished === undefined) return steps
      steps.push({ kind: 'run', runId: finished.runId, outcome: finished.outcome })
      const turn = { threadId: agent.threadId, turnId: finished.runId }
      const calls = callsById()
      const answered = new Set<string>()
      resume = undefined

      if (finished.outcome === 'success') {
        if (finished.pendingToolCallIds.length === 0) return steps
        for (const id of finished.pendingToolCallIds) {
          const call = calls.get(id)
          if (call === undefined) continue
          if (pageTools.actionIdOf(call.function.name) === undefined) {
            // A call the page does not own and nothing asked about: the backend's to answer.
            steps.push({ kind: 'left-pending', tool: call.function.name })
            continue
          }
          await answerPageTool(call, turn, steps)
          answered.add(call.function.name)
        }
        if (answered.size === 0) return steps
        answering = declared.filter(tool => answered.has(tool.name))
        continue
      }

      if (finished.outcome === 'interrupt') {
        resume = []
        for (const interrupt of finished.interrupts) {
          const call =
            interrupt.toolCallId === undefined ? undefined : calls.get(interrupt.toolCallId)
          if (call === undefined) {
            resume.push({ interruptId: interrupt.id, status: 'cancelled' })
          } else if (isTanStackClientTool(interrupt)) {
            // Answered both ways, as TanStack AI's own client does: the result as a tool message,
            // and as the interrupt's payload.
            const payload = await answerPageTool(call, turn, steps)
            answered.add(call.function.name)
            resume.push({ interruptId: interrupt.id, status: 'resolved', payload })
          } else {
            const approved = await options.approveBackendTool({
              toolName: call.function.name,
              input: JSON.parse(call.function.arguments || '{}') as unknown,
              ...(interrupt.message === undefined ? {} : { message: interrupt.message }),
            })
            steps.push({ kind: 'approval', tool: call.function.name, approved })
            resume.push(approvalResume(interrupt, call, approved))
          }
        }
        answering = declared.filter(tool => answered.has(tool.name))
        continue
      }

      return steps
    }
    steps.push({
      kind: 'error',
      message: `The turn took more than ${String(MAX_RUNS_PER_TURN)} runs.`,
    })
    return steps
  }

  return {
    send,
    get messages() {
      return agent.messages
    },
  }
}
