/**
 * What the shell's chat module does between the action registry and the wire, with no agent
 * library in it: the page's actions as AG-UI tools, a call the agent made run through the action
 * pipeline, the page's agent context as AG-UI context, and the answer to a backend's approval.
 * Everything here is AG-UI 1.0 as the spec writes it, so a backend swap never reaches it.
 */

import type { Context, Interrupt, ResumeEntry, Tool, ToolCall } from '@ag-ui/core'
import type { ActionExecutionResult, MfeRuntime } from '@company/mfe-react'

type ActionEntry = ReturnType<MfeRuntime['actions']['getSnapshot']>[number]

/** What the pipeline's approval step asks the chat's card. */
export type ApprovalRequest = Parameters<Parameters<MfeRuntime['actions']['setApprover']>[0]>[0]

/** The chat thread and the run a call came from, which the audit records. */
export interface ChatTurn {
  readonly threadId: string
  readonly turnId: string
}

/**
 * Model APIs take `^[a-zA-Z0-9_-]{1,64}$` as a tool name, so an action id such as
 * `operations:acknowledge-alert` cannot go as it is. The name is looked up again when a call comes
 * back, never parsed.
 */
export function toolNameOf(actionId: string): string {
  return actionId
    .replace(':', '__')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)
}

export interface PageToolList {
  readonly tools: readonly Tool[]
  /** The action a tool name stands for in this list. */
  actionIdOf(toolName: string): string | undefined
}

/**
 * Every action the page offers the agent right now: its placements include `'agent'` and its
 * `canExecute` allows it. Mounts come and go, so this is read again before every run.
 */
export function listPageTools(runtime: MfeRuntime): PageToolList {
  const byName = new Map<string, ActionEntry>()
  for (const entry of runtime.actions.getSnapshot()) {
    if (!entry.placements.includes('agent') || !entry.decision.allowed) continue
    const name = toolNameOf(entry.id)
    if (!byName.has(name)) byName.set(name, entry)
  }

  return {
    tools: [...byName].map(([name, entry]) => ({
      name,
      description: entry.description ?? entry.label,
      parameters: entry.inputSchema ?? { type: 'object', properties: {} },
    })),
    actionIdOf: name => byName.get(name)?.id,
  }
}

/** What the agent is told of a run, as the tool's result. */
export type PageToolResult =
  | { readonly status: 'executed'; readonly value: unknown }
  | { readonly status: 'denied' | 'declined'; readonly reason: string }
  | {
      readonly status: 'invalid' | 'unavailable' | 'failed'
      readonly error: { readonly code: string; readonly message: string }
    }

function describe(result: ActionExecutionResult): PageToolResult {
  switch (result.status) {
    case 'executed':
      return { status: 'executed', value: result.value }
    case 'denied':
    case 'declined':
      return { status: result.status, reason: result.reason }
    default:
      return {
        status: result.status,
        error: { code: result.error.code, message: result.error.message },
      }
  }
}

/**
 * Runs one call the agent made through the action pipeline (validation, approval, serialized
 * writes, audit) and answers what the agent is told. The list is read again first: an action whose
 * mount has gone since the tools were sent is answered as unavailable, never run.
 */
export async function runPageTool(
  runtime: MfeRuntime,
  call: ToolCall,
  turn: ChatTurn,
): Promise<PageToolResult> {
  const actionId = listPageTools(runtime).actionIdOf(call.function.name)
  if (actionId === undefined) {
    return {
      status: 'unavailable',
      error: {
        code: 'action/unavailable',
        message: `The page no longer offers '${call.function.name}'.`,
      },
    }
  }

  let input: unknown
  try {
    input = call.function.arguments.trim() === '' ? {} : JSON.parse(call.function.arguments)
  } catch {
    return {
      status: 'invalid',
      error: { code: 'contract/input-mismatch', message: 'The arguments are not JSON.' },
    }
  }

  return describe(await runtime.actions.execute(actionId, { caller: 'agent', input, turn }))
}

/**
 * The page's agent context for one run, as AG-UI context: where the user is (the URL and the Apps
 * it is inside), then each selection a mount published. Read when the run is sent.
 */
export function turnContext(runtime: MfeRuntime): Context[] {
  const { url, apps, selections } = runtime.agentContext.read()
  return [
    {
      description: 'Where the user is: the page URL, and each App it is inside with its own path',
      value: JSON.stringify({ url, apps }),
    },
    ...selections.map(selection => ({
      description: selection.description,
      value: JSON.stringify({
        definitionId: selection.definitionId,
        value: selection.value,
        capturedAt: selection.capturedAt,
      }),
    })),
  ]
}

/**
 * The answer to a backend's approval interrupt, in the one shape both backends read: TanStack AI
 * reads `approved`; Agent Framework also takes the call, which it checks against the one it
 * recorded when it asked, so an answer cannot approve a call it never surfaced.
 */
export function approvalResume(
  interrupt: Interrupt,
  call: ToolCall,
  approved: boolean,
): ResumeEntry {
  return {
    interruptId: interrupt.id,
    status: 'resolved',
    payload: {
      approved,
      toolCall: {
        callId: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      },
    },
  }
}

function parseArguments(text: string): unknown {
  try {
    return text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    return {}
  }
}
