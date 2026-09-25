/**
 * The passive way a Widget in the chat hands a value back (agentic plan, F): the latest payload of
 * each output of each Widget shown in the conversation, readable by the agent in later turns as
 * agent context. It never starts a turn; a Widget that means to, on the user's press, calls
 * `useAgentPrompt` like any mount.
 */

import type { ChatContext } from '@company/mfe-agent'

/** The most the whole entry may take as JSON, as a selection may (§46). */
const MAX_LENGTH = 4096

interface Latest {
  readonly toolCallId: string
  readonly widgetId: string
  readonly output: string
  readonly payload: unknown
  readonly at: string
}

export class WidgetOutputs {
  /** By call and output, in the order they last changed. */
  readonly #latest = new Map<string, Latest>()

  record(toolCallId: string, widgetId: string, output: string, payload: unknown): void {
    const key = `${toolCallId}\u0000${output}`
    this.#latest.delete(key)
    this.#latest.set(key, { toolCallId, widgetId, output, payload, at: new Date().toISOString() })
  }

  clear(): void {
    this.#latest.clear()
  }

  /** One context entry, newest first, cut to what fits. */
  context(): ChatContext[] {
    if (this.#latest.size === 0) return []
    const newest = [...this.#latest.values()].reverse()
    const kept: Latest[] = []
    for (const entry of newest) {
      if (JSON.stringify([...kept, entry]).length > MAX_LENGTH) break
      kept.push(entry)
    }
    return [
      {
        description:
          'The latest output of each Widget shown in this chat, newest first: what the user picked or changed in it',
        value: JSON.stringify(kept),
      },
    ]
  }
}
