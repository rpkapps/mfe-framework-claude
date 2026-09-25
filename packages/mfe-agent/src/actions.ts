/**
 * The page's side of the chat: the actions the page offers the agent as the chat's tools, each
 * call run through the action pipeline, the pipeline's approval step answered by the chat's card,
 * and the agent context sent with every run.
 *
 * ```ts
 * const chat = new ChatClient({
 *   connection: fetchServerSentEvents('/agent'),
 *   tools: () => actionTools(runtime.actions),
 *   agentContext: () => agentContextOf(runtime.agentContext),
 * })
 * runtime.actions.setApprover(approvalsIn(chat.requestApproval))
 * ```
 */

import type { Context } from '@ag-ui/core'
import type { ActionEntry } from '@company/mfe-core'
import type {
  ActionApprover,
  ActionExecutionResult,
  ActionRegistry,
  AgentContextStore,
} from '@company/mfe-runtime'

import type { ApprovalQuestion, ChatTool } from './types.ts'

/**
 * Model APIs take `^[a-zA-Z0-9_-]{1,64}$` as a tool name, so an action id such as
 * `operations:acknowledge-alert` cannot go as it is. A call is matched back to its action by
 * looking the name up in the list, never by parsing it.
 */
export function toolNameOf(actionId: string): string {
  return actionId
    .replace(':', '__')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)
}

/** What the agent is told of a run, as the tool's result. */
export type ActionToolResult =
  | { readonly status: 'executed'; readonly value: unknown }
  | { readonly status: 'denied' | 'declined'; readonly reason: string }
  | {
      readonly status: 'invalid' | 'unavailable' | 'failed'
      readonly error: { readonly code: string; readonly message: string }
    }

function describe(result: ActionExecutionResult): ActionToolResult {
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

type Actions = Pick<ActionRegistry, 'getSnapshot' | 'execute'>

function offered(actions: Actions): Map<string, ActionEntry> {
  const byName = new Map<string, ActionEntry>()
  for (const entry of actions.getSnapshot()) {
    if (!entry.placements.includes('agent') || !entry.decision.allowed) continue
    const name = toolNameOf(entry.id)
    if (!byName.has(name)) byName.set(name, entry)
  }
  return byName
}

/**
 * Every action the page offers the agent now, as the chat's tools: its placements include
 * `'agent'` and its `canExecute` allows it. Pass it as a function, so the chat reads it again
 * before every run. A call runs through the pipeline as the caller `'agent'`, with the chat's
 * thread and run as its turn; an action whose mount has gone since is answered `unavailable`.
 */
export function actionTools(actions: Actions): ChatTool[] {
  return [...offered(actions)].map(([name, entry]) => ({
    name,
    description: entry.description ?? entry.label,
    ...(entry.inputSchema === undefined ? {} : { inputSchema: entry.inputSchema }),
    execute: async (input, { threadId, runId }): Promise<ActionToolResult> => {
      if (!offered(actions).has(name)) {
        return {
          status: 'unavailable',
          error: { code: 'action/unavailable', message: `The page no longer offers '${name}'.` },
        }
      }
      const result = await actions.execute(entry.id, {
        caller: 'agent',
        input,
        turn: { threadId, turnId: runId },
      })
      return describe(result)
    },
  }))
}

/**
 * The pipeline's approver, answered by the chat's card: pass `chat.requestApproval` and give the
 * result to `actions.setApprover`. The card shows the action's label and description.
 */
export function approvalsIn(
  requestApproval: (question: ApprovalQuestion) => Promise<boolean>,
): ActionApprover {
  return request =>
    requestApproval({
      toolName: toolNameOf(request.actionId),
      input: request.input,
      label: request.label,
      ...(request.description === undefined ? {} : { description: request.description }),
    })
}

/**
 * The page's agent context as AG-UI context, read when a run is sent: where the user is (the URL
 * and each App it is inside, with that App's own path), then each selection a mount published.
 */
export function agentContextOf(store: Pick<AgentContextStore, 'read'>): Context[] {
  const { url, apps, selections } = store.read()
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
