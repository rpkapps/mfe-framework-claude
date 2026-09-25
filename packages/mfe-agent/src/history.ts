/**
 * What a run sends of the conversation. AG-UI sends the whole history with every run, and a long
 * session with big tool results (tables, rendered UI, widget outputs) outgrows a model's context
 * well before the user is done with it. The policy here shrinks only the copy a run sends: the
 * history the transcript renders keeps every message whole.
 */

import type { Message } from '@ag-ui/core'

const DEFAULT_KEEP_TURNS = 6
const DEFAULT_MAX_TOOL_RESULT_CHARS = 2000

/** How much of the conversation a run sends whole; see `limitHistory`. */
export interface HistoryLimit {
  /**
   * The last this many user turns, a user message and everything after it, are sent whole.
   * Defaults to 6; the turn being run is always whole, so anything below 1 counts as 1.
   */
  readonly keepTurns?: number
  /**
   * In an older turn, a tool result longer than this many characters is sent as a short stand-in.
   * Defaults to 2000.
   */
  readonly maxToolResultChars?: number
}

function lengthOf(content: string | readonly unknown[]): number {
  return typeof content === 'string' ? content.length : JSON.stringify(content).length
}

/**
 * What the agent reads in place of a result it was sent in full earlier. It says what is missing
 * and how to get it back, so the agent calls the tool again rather than guessing at the result.
 */
function standIn(length: number): string {
  return `[Result omitted from this request: ${length.toLocaleString('en-US')} characters. Call the tool again if it is needed.]`
}

/**
 * The client's default `history` policy: the last `keepTurns` user turns go whole; in older turns
 * a tool result over `maxToolResultChars` is replaced by a stand-in, and reasoning is left out.
 *
 * A message is shortened, never dropped, other than reasoning: every tool call keeps its result
 * and every result its call, since backends and model APIs reject a history with either side
 * missing. Ids are kept too, so a backend that echoes the input still matches each message to the
 * one the client holds.
 */
export function limitHistory(
  messages: readonly Message[],
  {
    keepTurns = DEFAULT_KEEP_TURNS,
    maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
  }: HistoryLimit = {},
): Message[] {
  const turns = Math.max(1, keepTurns)
  // Where the kept turns start: the `turns`-th user message from the end.
  let start = -1
  let seen = 0
  for (let index = messages.length - 1; index >= 0 && seen < turns; index -= 1) {
    if (messages[index]?.role !== 'user') continue
    seen += 1
    if (seen === turns) start = index
  }
  if (start <= 0) return [...messages]

  const older = messages.slice(0, start).flatMap((message): Message[] => {
    // The model's own thinking in a turn long over: large, and read by nothing downstream.
    if (message.role === 'reasoning') return []
    if (message.role !== 'tool') return [message]
    const length = lengthOf(message.content)
    if (length <= maxToolResultChars) return [message]
    // A provider's opaque artefact belongs to the content it stands beside, which is gone.
    const { encryptedValue: _artefact, ...rest } = message
    return [{ ...rest, content: standIn(length) }]
  })
  return [...older, ...messages.slice(start)]
}
