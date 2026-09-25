/**
 * The one approval card (agentic plan, E), pinned above the composer so it never scrolls away:
 * a page action the pipeline asks about and a backend tool the backend stopped for look the same
 * and are answered the same way. A backend's other questions get a plain continue-or-cancel card.
 * Each new question is announced; focus is left where the user has it.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { ChatInterrupt, GenericInterrupt, ToolApprovalInterrupt } from '@company/mfe-agent'
import { Button } from '@tecton/react/components/button'
import { ShieldQuestionIcon } from 'lucide-react'

import { useActionLabel } from './hooks.ts'
import { humanize } from './tool-stage.ts'

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

function ApprovalCard({ interrupt }: { readonly interrupt: ToolApprovalInterrupt }): ReactNode {
  const actionLabel = useActionLabel(interrupt.toolName)
  const title = interrupt.label ?? actionLabel ?? humanize(interrupt.toolName)
  const titleId = useId()

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-slot="chat-approval"
      data-source={interrupt.source}
      className="flex flex-col gap-2 rounded-lg border border-warning/60 bg-card p-3"
    >
      <p id={titleId} className="flex items-center gap-2 text-sm font-medium">
        <ShieldQuestionIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          Allow the assistant to {title.charAt(0).toLowerCase() + title.slice(1)}?
        </span>
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
            interrupt.resolveInterrupt(false)
          }}
        >
          Decline
        </Button>
        <Button
          size="sm"
          onPress={() => {
            interrupt.resolveInterrupt(true)
          }}
        >
          Allow
        </Button>
      </div>
    </div>
  )
}

function QuestionCard({ interrupt }: { readonly interrupt: GenericInterrupt }): ReactNode {
  const titleId = useId()
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-slot="chat-interrupt"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <p id={titleId} className="text-sm font-medium">
        {interrupt.message ?? humanize(interrupt.reason)}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onPress={() => {
            interrupt.cancel()
          }}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onPress={() => {
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
  interrupts,
}: {
  readonly interrupts: readonly ChatInterrupt[]
}): ReactNode {
  // Announced once per question, by id, in a polite region that is always rendered.
  const [announcement, setAnnouncement] = useState('')
  const announced = useRef(new Set<string>())
  useEffect(() => {
    const fresh = interrupts.filter(interrupt => !announced.current.has(interrupt.id))
    for (const interrupt of fresh) announced.current.add(interrupt.id)
    if (fresh.length > 0) {
      setAnnouncement(
        fresh.length === 1
          ? 'The assistant is waiting for your answer.'
          : `${String(fresh.length)} questions are waiting for your answer.`,
      )
    }
  }, [interrupts])

  return (
    <>
      <div role="status" className="sr-only">
        {announcement}
      </div>
      {interrupts.length > 0 && (
        <div data-slot="chat-interrupts" className="flex flex-col gap-2">
          {interrupts.map(interrupt =>
            interrupt.kind === 'tool-approval' ? (
              <ApprovalCard key={interrupt.id} interrupt={interrupt} />
            ) : (
              <QuestionCard key={interrupt.id} interrupt={interrupt} />
            ),
          )}
        </div>
      )}
    </>
  )
}
