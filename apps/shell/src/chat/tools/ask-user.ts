/**
 * The ask_user tool: the agent asks the user a question it needs answered to carry on, and the
 * transcript shows it as a Tecton `Questionnaire` in the call's place. Submitting answers the call
 * with the answers; cancelling it, stopping the turn or clearing the chat answers it as declined,
 * so a turn never waits on a question nobody can see.
 */

import type { ChatTool } from '@company/mfe-agent'
import { z } from 'zod'

import { SHELL_TOOLS } from './names.ts'

export const AskUserInput = z.object({
  title: z.string().max(120).optional(),
  questions: z
    .array(
      z.object({
        name: z
          .string()
          .regex(/^[a-zA-Z][\w-]*$/)
          .describe('The key of this answer in the result.'),
        question: z.string().min(1).max(200),
        description: z.string().max(300).optional(),
        choices: z
          .array(
            z.object({
              value: z.string().min(1),
              label: z.string().min(1),
              description: z.string().optional(),
            }),
          )
          .max(8)
          .optional(),
        multiple: z.boolean().optional().describe('Whether several choices may be picked.'),
        freeform: z.boolean().optional().describe('Whether the user may type an answer instead.'),
        required: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(5),
})
export type AskUserInput = z.infer<typeof AskUserInput>

export type Answers = Readonly<Record<string, string | readonly string[]>>

export type AskUserResult =
  | { readonly status: 'answered'; readonly answers: Answers }
  | { readonly status: 'declined'; readonly reason: string }
  | { readonly status: 'invalid'; readonly error: string }

/** A question waiting for the user, by the call that asked it. */
export interface PendingQuestion {
  readonly toolCallId: string
  readonly input: AskUserInput
  answer(answers: Answers): void
  decline(): void
}

/** The questions waiting on the user; the transcript subscribes to find the one for a call. */
export class Questions {
  #pending: ReadonlyMap<string, PendingQuestion> = new Map()
  readonly #listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): ReadonlyMap<string, PendingQuestion> => this.#pending

  ask(toolCallId: string, input: AskUserInput, signal: AbortSignal): Promise<AskUserResult> {
    return new Promise(resolve => {
      const settle = (result: AskUserResult): void => {
        if (!this.#pending.has(toolCallId)) return
        const next = new Map(this.#pending)
        next.delete(toolCallId)
        this.#set(next)
        resolve(result)
      }
      const decline = (): void => {
        settle({ status: 'declined', reason: 'The user did not answer.' })
      }

      this.#set(
        new Map(this.#pending).set(toolCallId, {
          toolCallId,
          input,
          answer: answers => {
            settle({ status: 'answered', answers })
          },
          decline,
        }),
      )
      if (signal.aborted) decline()
      else signal.addEventListener('abort', decline, { once: true })
    })
  }

  #set(next: ReadonlyMap<string, PendingQuestion>): void {
    this.#pending = next
    for (const listener of this.#listeners) listener()
  }
}

export function askUserTool(questions: Questions): ChatTool {
  return {
    name: SHELL_TOOLS.askUser,
    description:
      'Ask the user something you need to know to carry on: a choice between options, or a short answer. ' +
      'The chat shows the questions as a form; you get the answers back by `name`, or `declined`.',
    inputSchema: z.toJSONSchema(AskUserInput),
    execute: async (input, { toolCallId, signal }): Promise<AskUserResult> => {
      const parsed = AskUserInput.safeParse(input)
      if (!parsed.success) return { status: 'invalid', error: z.prettifyError(parsed.error) }
      return await questions.ask(toolCallId, parsed.data, signal)
    },
  }
}
