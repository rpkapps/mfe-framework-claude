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

  /** Forgets the Widgets whose calls are no longer in the history: they are not in the chat. */
  prune(calls: ReadonlySet<string>): void {
    for (const [key, entry] of this.#latest) {
      if (!calls.has(entry.toolCallId)) this.#latest.delete(key)
    }
  }

  clear(): void {
    this.#latest.clear()
  }

  /**
   * One context entry, newest first, with what fits. A payload that cannot be JSON (a cycle, a
   * BigInt) is left out rather than failing every run; with nothing that fits, there is no entry.
   */
  context(): ChatContext[] {
    const kept: string[] = []
    // The brackets of the array.
    let length = 2
    for (const entry of [...this.#latest.values()].reverse()) {
      const json = serialise(entry)
      if (json === undefined) continue
      const added = json.length + (kept.length === 0 ? 0 : 1)
      if (length + added > MAX_LENGTH) continue
      kept.push(json)
      length += added
    }
    if (kept.length === 0) return []
    return [
      {
        description:
          'The latest output of each Widget shown in this chat, newest first: what the user picked or changed in it',
        value: `[${kept.join(',')}]`,
      },
    ]
  }
}

function serialise(entry: Latest): string | undefined {
  try {
    return JSON.stringify(entry)
  } catch {
    return undefined
  }
}
