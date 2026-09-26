/**
 * What a message offers besides its content: copying it, asking again for the last reply, and
 * editing a question to ask again from there. The buttons are in the tab order but faint until the
 * message is hovered or holds focus, and the last reply's always show, since a touch screen has no
 * hover.
 */

import { useRef, useState, type ReactNode } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import { Textarea } from '@tecton/react/components/textarea'
import { Tooltip, TooltipTrigger } from '@tecton/react/components/tooltip'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { CircleStopIcon, PencilIcon, RotateCcwIcon } from 'lucide-react'

import { quote } from './quote.ts'
import type { ShellChat } from './shell-chat.ts'

function Row({
  shown,
  align = 'start',
  label,
  children,
}: {
  readonly shown: boolean
  readonly align?: 'start' | 'end'
  readonly label: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="chat-message-actions"
      className={`flex items-center gap-0.5 transition-opacity ${align === 'end' ? 'self-end' : ''} ${
        shown
          ? ''
          : 'opacity-0 group-hover/message:opacity-100 focus-within:opacity-100 has-[[data-pressed]]:opacity-100'
      }`}
    >
      {children}
    </div>
  )
}

/** Copy, and for the last reply while the chat is idle, ask again. */
export function ReplyActions({
  chat,
  text,
  last,
  idle,
}: {
  readonly chat: ShellChat
  readonly text: string
  readonly last: boolean
  readonly idle: boolean
}): ReactNode {
  return (
    <Row shown={last} label="Reply actions">
      {text !== '' && <CopyButton value={text} size="icon-xs" aria-label="Copy the reply" />}
      {last && idle && (
        <TooltipTrigger>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Ask again"
            onPress={() => {
              void chat.client.reload()
            }}
          >
            <RotateCcwIcon />
          </Button>
          <Tooltip>Ask again</Tooltip>
        </TooltipTrigger>
      )}
    </Row>
  )
}

/**
 * Says the reply failed, with a way to ask for it again. Asking again, here or on the last reply, is
 * the client's `reload`, which sends the question with what went with it the first time: a page's
 * context, a chip's tool, an A2UI event.
 */
export function ReplyFailed({
  chat,
  error,
}: {
  readonly chat: ShellChat
  readonly error: Error
}): ReactNode {
  return (
    <Alert variant="destructive" appearance="outline">
      <AlertTitle>The assistant could not answer</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
      <AlertAction>
        <Button
          variant="outline"
          size="xs"
          onPress={() => {
            void chat.client.reload()
          }}
        >
          Try again
        </Button>
      </AlertAction>
    </Alert>
  )
}

/** Says a reply did not finish: the user stopped it here. */
export function StoppedNote(): ReactNode {
  return (
    <p data-slot="chat-stopped" className="flex items-center gap-1 text-xs text-muted-foreground">
      <CircleStopIcon className="size-3.5" aria-hidden />
      Stopped
    </p>
  )
}

/** Copy and edit, under a question the user asked. */
export function QuestionActions({
  text,
  onEdit,
}: {
  readonly text: string
  readonly onEdit: () => void
}): ReactNode {
  return (
    <Row shown={false} align="end" label="Message actions">
      <CopyButton value={text} size="icon-xs" aria-label="Copy your message" />
      <TooltipTrigger>
        <Button variant="ghost" size="icon-xs" aria-label="Edit your message" onPress={onEdit}>
          <PencilIcon />
        </Button>
        <Tooltip>Edit</Tooltip>
      </TooltipTrigger>
    </Row>
  )
}

/**
 * A question being edited, in place: Enter asks again from here, Shift+Enter is a new line, Escape
 * leaves it as it was. The replies after it go once it is sent.
 */
export function EditQuestion({
  chat,
  messageId,
  quoted,
  text,
  onDone,
}: {
  readonly chat: ShellChat
  readonly messageId: string
  readonly quoted: string
  readonly text: string
  /** Called with whether it was sent: a sent edit replaces the message the focus came from. */
  readonly onDone: (sent: boolean) => void
}): ReactNode {
  const [draft, setDraft] = useState(text)
  const box = useRef<HTMLTextAreaElement>(null)
  const send = (): void => {
    if (draft.trim() === '') return
    void chat.edit(messageId, quoted === '' ? '' : quote(quoted), draft.trim())
    onDone(true)
  }

  return (
    <form
      data-slot="chat-edit-message"
      className="flex w-full flex-col gap-2"
      onSubmit={event => {
        event.preventDefault()
        send()
      }}
    >
      <Textarea
        ref={box}
        aria-label="Edit your message"
        // Focus moves here as the editor opens, as a dialog would take it.
        autoFocus
        value={draft}
        rows={2}
        className="max-h-48 min-h-16 text-sm"
        onChange={event => {
          setDraft(event.target.value)
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          } else if (event.key === 'Escape') {
            // Handled here, so a sheet around the chat stays open.
            event.preventDefault()
            event.stopPropagation()
            onDone(false)
          }
        }}
      />
      <p className="text-xs text-muted-foreground">
        Asking again replaces the replies after this message.
      </p>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            onDone(false)
          }}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" isDisabled={draft.trim() === ''}>
          Ask again
        </Button>
      </div>
    </form>
  )
}
