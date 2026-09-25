/**
 * The one approval card (agentic plan, E), pinned above the composer so it never scrolls away:
 * a page action the pipeline asks about and a backend tool the backend stopped for look the same
 * and are answered the same way. A backend's other questions get a plain continue-or-cancel card.
 * A card takes focus when the user is waiting on the assistant, and is announced otherwise; once it
 * is answered focus moves to the next one or the message box (`waiting-focus.ts`).
 */

import { useId, useRef, type ReactNode } from 'react'
import type { ChatInterrupt, GenericInterrupt, ToolApprovalInterrupt } from '@company/mfe-agent'
import { Button } from '@tecton/react/components/button'
import { ShieldQuestionIcon } from 'lucide-react'

import { useActionLabel } from './hooks.ts'
import type { ShellChat } from './shell-chat.ts'
import { humanize } from './tool-stage.ts'
import { focusAfterAnswer, useFocusWhenWaiting, WAITING } from './waiting-focus.ts'

/** A focused card shows it; a card is not in the tab order, only focused when it appears. */
const CARD_FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring'

function Inputs({ value }: { readonly value: unknown }): ReactNode {
  if (typeof value !== 'object' || value === null) return null
  const entries = Object.entries(value)
  if (entries.length === 0) return null
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {entries.map(([name, item]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="min-w-0 font-mono wrap-break-word">
            {typeof item === 'string' ? item : JSON.stringify(item)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ApprovalCard({
  chat,
  interrupt,
}: {
  readonly chat: ShellChat
  readonly interrupt: ToolApprovalInterrupt
}): ReactNode {
  const actionLabel = useActionLabel(interrupt.toolName)
  const title = interrupt.label ?? actionLabel ?? humanize(interrupt.toolName)
  const question = `Allow the assistant to ${title.charAt(0).toLowerCase() + title.slice(1)}?`
  const titleId = useId()
  const card = useRef<HTMLDivElement>(null)
  useFocusWhenWaiting(chat, card, question)
  const answer = (allowed: boolean): void => {
    focusAfterAnswer(chat, card.current)
    interrupt.resolveInterrupt(allowed)
  }

  return (
    <div
      ref={card}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      {...{ [WAITING]: '' }}
      data-slot="chat-approval"
      data-source={interrupt.source}
      className={`flex flex-col gap-2 rounded-lg border border-warning/60 bg-card p-3 ${CARD_FOCUS}`}
    >
      <p id={titleId} className="flex items-center gap-2 text-sm font-medium">
        <ShieldQuestionIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">{question}</span>
      </p>
      {(interrupt.description ?? interrupt.message) !== undefined && (
        <p className="text-xs text-muted-foreground">
          {interrupt.description ?? interrupt.message}
        </p>
      )}
      <Inputs value={interrupt.originalArgs} />
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onPress={() => {
            answer(false)
          }}
        >
          Decline
        </Button>
        <Button
          size="sm"
          onPress={() => {
            answer(true)
          }}
        >
          Allow
        </Button>
      </div>
    </div>
  )
}

function QuestionCard({
  chat,
  interrupt,
}: {
  readonly chat: ShellChat
  readonly interrupt: GenericInterrupt
}): ReactNode {
  const titleId = useId()
  const question = interrupt.message ?? humanize(interrupt.reason)
  const card = useRef<HTMLDivElement>(null)
  useFocusWhenWaiting(chat, card, question)

  return (
    <div
      ref={card}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      {...{ [WAITING]: '' }}
      data-slot="chat-interrupt"
      className={`flex flex-col gap-2 rounded-lg border border-border bg-card p-3 ${CARD_FOCUS}`}
    >
      <p id={titleId} className="text-sm font-medium">
        {question}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onPress={() => {
            focusAfterAnswer(chat, card.current)
            interrupt.cancel()
          }}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onPress={() => {
            focusAfterAnswer(chat, card.current)
            interrupt.resolveInterrupt({})
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

export function Interrupts({
  chat,
  interrupts,
}: {
  readonly chat: ShellChat
  readonly interrupts: readonly ChatInterrupt[]
}): ReactNode {
  if (interrupts.length === 0) return null
  return (
    <div data-slot="chat-interrupts" className="flex flex-col gap-2">
      {interrupts.map(interrupt =>
        interrupt.kind === 'tool-approval' ? (
          <ApprovalCard key={interrupt.id} chat={chat} interrupt={interrupt} />
        ) : (
          <QuestionCard key={interrupt.id} chat={chat} interrupt={interrupt} />
        ),
      )}
    </div>
  )
}
