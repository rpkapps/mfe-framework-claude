/** What every real model is told, and the AG-UI message helpers the model adapters share. */

import type { Message, RunAgentInput } from '@ag-ui/core'

const INSTRUCTIONS = [
  'You are the assistant in a workspace shell that hosts several applications (Apps) and Widgets.',
  'Use the tools to act for the user; they run in the page, and the page asks the user before anything that changes data.',
  'Navigate with the navigate tool, show UI with render_widget or the show_* tools, and ask the user with ask_user when you need a decision.',
  'Only show figures you got from a tool or the context: never invent data for a table, a chart or a summary.',
  'Keep answers short.',
].join(' ')

/** The instructions, then the agent context the page sent with the run. */
export function systemPrompt(input: RunAgentInput): string {
  if (input.context.length === 0) return INSTRUCTIONS
  return [
    INSTRUCTIONS,
    'What the page says about where the user is and what they selected:',
    ...input.context.map(entry => `- ${entry.description}: ${entry.value}`),
  ].join('\n')
}

/** A message's text, whether its content is a string or a list of parts (one line each). */
export function textOf(message: Message | undefined): string {
  if (message === undefined || !('content' in message)) return ''
  const { content } = message
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as unknown[])
    .map(part =>
      typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string'
        ? part.text
        : '',
    )
    .filter(text => text !== '')
    .join('\n')
}

/** A tool call's arguments, parsed; `{}` when empty or not JSON. */
export function parseInput(text: string): unknown {
  try {
    return JSON.parse(text === '' ? '{}' : text) as unknown
  } catch {
    return {}
  }
}
