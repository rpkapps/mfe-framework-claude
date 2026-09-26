/**
 * The chat's slash commands: the chat's own, then each action the page offers the agent. Picking
 * an action does not run it; it asks the assistant to, as a chip naming the tool, so the model
 * fills its inputs, the approval card still asks, and the conversation keeps the result. Running
 * an action directly is the palette's job.
 */

import { toolNameOf } from '@company/mfe-agent/actions'
import { HOST_SCOPE } from '@company/mfe-react'

import type { ActionEntry } from './hooks.ts'
import type { ChatAttachment } from './panel.ts'

export interface ChatCommand {
  readonly id: string
  readonly command: string
  readonly label: string
  readonly description?: string
  readonly group: string
  /** The page's action this command asks for; none for the chat's own. */
  readonly action?: ActionEntry
}

export const NEW_CONVERSATION: ChatCommand = {
  id: 'chat:new',
  command: 'new',
  label: 'Start a new conversation',
  group: 'Chat',
}

/** Commands are one word: a name that is not becomes lower-case words joined by hyphens. */
function commandOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'action'
  )
}

/**
 * The chat's own, then the actions of what is mounted, then the shell's, which are there on every
 * page. Each is one word to type; the Apps' say which App they are from.
 */
export function chatCommands(actions: readonly ActionEntry[]): ChatCommand[] {
  const taken = new Set([NEW_CONVERSATION.command])
  const command = (entry: ActionEntry, group: string): ChatCommand => {
    const base = commandOf(entry.name)
    let typed = base
    // Two mounts of one Widget offer the same name; the second is told apart as the id is.
    for (let n = 2; taken.has(typed); n += 1) typed = `${base}-${String(n)}`
    taken.add(typed)
    return {
      id: `action:${entry.id}`,
      command: typed,
      label: entry.label,
      ...(entry.definitionId === HOST_SCOPE ? {} : { description: entry.definitionId }),
      group,
      action: entry,
    }
  }
  const page = actions.filter(entry => entry.definitionId !== HOST_SCOPE)
  const shell = actions.filter(entry => entry.definitionId === HOST_SCOPE)
  return [
    NEW_CONVERSATION,
    ...page.map(entry => command(entry, 'This page')),
    ...shell.map(entry => command(entry, 'Everywhere')),
  ]
}

/** The chip a picked action becomes: the tool to use goes to the model as the turn's context. */
export function actionAttachment(action: ActionEntry): ChatAttachment {
  return {
    id: `action:${action.id}`,
    kind: 'action',
    label: action.label,
    description: 'Action',
    context: {
      description:
        'The user picked this action with a slash command: use this tool for their message',
      value: toolNameOf(action.id),
    },
  }
}
