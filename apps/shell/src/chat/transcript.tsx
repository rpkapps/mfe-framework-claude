/**
 * The conversation, in Tecton's conversation components. The transcript is a `role="log"` that is
 * `aria-busy` while a reply streams, so a screen reader reads each reply once, complete; the
 * composer announces only its own changes.
 */

import { Fragment, useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ChatSnapshot, UIMessage } from '@company/mfe-agent'
import { Bubble, BubbleContent } from '@tecton/react/components/bubble'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@tecton/react/components/collapsible'
import { Marker, MarkerContent, MarkerIcon } from '@tecton/react/components/marker'
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageGroup,
} from '@tecton/react/components/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@tecton/react/components/message-scroller'
import { Spinner } from '@tecton/react/components/spinner'
import { BotIcon, ChevronDownIcon } from 'lucide-react'

import { NotShown, PartBoundary, RenderBoundary } from './boundary.tsx'
import { useStopped } from './hooks.ts'
import { Markdown } from './markdown.tsx'
import { EditQuestion, QuestionActions, ReplyActions, StoppedNote } from './message-actions.tsx'
import { splitQuote } from './quote.ts'
import type { ShellChat } from './shell-chat.ts'
import { DISCLOSURE_MOTION, ToolCallView } from './tool-call.tsx'
import { stageOf } from './tool-stage.ts'

function textOf(message: UIMessage): string {
  return message.parts.flatMap(part => (part.type === 'text' ? [part.content] : [])).join('\n')
}

function UserMessage({
  chat,
  message,
}: {
  readonly chat: ShellChat
  readonly message: UIMessage
}): ReactNode {
  const { quoted, rest } = splitQuote(textOf(message))
  const [editing, setEditing] = useState(false)
  const editButton = useRef<HTMLDivElement>(null)
  return (
    <Message align="end" data-slot="chat-user-message" className="group/message">
      <MessageContent>
        {quoted !== '' && (
          <blockquote className="max-w-[80%] self-end border-s-2 border-border ps-2 text-xs whitespace-pre-wrap text-muted-foreground">
            {quoted}
          </blockquote>
        )}
        {editing ? (
          <EditQuestion
            chat={chat}
            messageId={message.id}
            quoted={quoted}
            text={rest}
            onDone={sent => {
              setEditing(false)
              // A sent edit replaces this message, so the next message is written in the composer.
              if (sent) {
                chat.panel.focus()
                return
              }
              // Back to where the edit began, as a dialog closing would.
              requestAnimationFrame(() => {
                editButton.current
                  ?.querySelector<HTMLElement>('[aria-label="Edit your message"]')
                  ?.focus()
              })
            }}
          />
        ) : (
          <>
            {rest !== '' && (
              <Bubble variant="secondary" align="end">
                <BubbleContent className="whitespace-pre-wrap">{rest}</BubbleContent>
              </Bubble>
            )}
            <div ref={editButton} className="contents">
              <QuestionActions
                text={rest}
                onEdit={() => {
                  setEditing(true)
                }}
              />
            </div>
          </>
        )}
      </MessageContent>
    </Message>
  )
}

function AssistantMessage({
  chat,
  message,
  last,
  idle,
  stopped,
}: {
  readonly chat: ShellChat
  readonly message: UIMessage
  /** The conversation's last message, which can be asked for again. */
  readonly last: boolean
  readonly idle: boolean
  readonly stopped: boolean
}): ReactNode {
  return (
    <Message data-slot="chat-assistant-message" className="group/message">
      <MessageAvatar className="size-6 min-w-6 self-start bg-primary/15 text-primary">
        <BotIcon className="size-3.5" aria-hidden />
      </MessageAvatar>
      <MessageContent>
        <MessageGroup>
          {message.parts.map((part, index) => {
            switch (part.type) {
              case 'text':
                return part.content === '' ? null : (
                  <PartBoundary key={index} resetKey={part.content}>
                    <Bubble variant="ghost">
                      <BubbleContent>
                        <Markdown go={chat.go}>{part.content}</Markdown>
                      </BubbleContent>
                    </Bubble>
                  </PartBoundary>
                )
              case 'thinking':
                return (
                  <Collapsible key={index} className="group/thinking text-xs text-muted-foreground">
                    <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Thinking
                      <ChevronDownIcon
                        className="size-3.5 transition-transform group-data-expanded/thinking:rotate-180"
                        aria-hidden
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent className={DISCLOSURE_MOTION}>
                      <p className="mt-1 border-s-2 ps-2 whitespace-pre-wrap">{part.content}</p>
                    </CollapsibleContent>
                  </Collapsible>
                )
              case 'tool-call':
                return (
                  // Tried again as the call moves on: arguments that were half there are whole.
                  <PartBoundary key={part.id} resetKey={stageOf(part)}>
                    <ToolCallView chat={chat} part={part} />
                  </PartBoundary>
                )
              case 'tool-result':
                // Folded into the call that asked for it.
                return null
            }
          })}
        </MessageGroup>
        {stopped && <StoppedNote />}
        <ReplyActions chat={chat} text={textOf(message)} last={last} idle={idle} />
      </MessageContent>
    </Message>
  )
}

/** One question and everything that answered it; messages before the first question are a turn too. */
interface Turn {
  readonly id: string
  readonly asked: boolean
  readonly messages: readonly UIMessage[]
}

export function turnsOf(messages: readonly UIMessage[]): Turn[] {
  const turns: { id: string; asked: boolean; messages: UIMessage[] }[] = []
  for (const message of messages) {
    const current = turns.at(-1)
    if (message.role === 'user' || current === undefined) {
      turns.push({ id: message.id, asked: message.role === 'user', messages: [message] })
    } else {
      current.messages.push(message)
    }
  }
  return turns
}

/**
 * How much of the previous turn the scroller keeps in view above a new question: its
 * `scrollPreviousItemPeek`, which the provider leaves at its default.
 */
const PREVIOUS_TURN_PEEK = 64

/**
 * The viewport's inner height, less the peek: the least the last turn takes up. A turn that fills
 * the view to the bottom never needs the scroller's filler below it, which the scroller sizes a
 * frame after a change. Without this, collapsing a card in the last turn shrank the page, the
 * browser pulled it down, and a frame later the filler pushed it back up.
 */
function useLastTurnHeight(): {
  readonly viewportRef: (element: HTMLDivElement | null) => void
  readonly minHeight: number | undefined
} {
  const [minHeight, setMinHeight] = useState<number>()
  const observer = useRef<ResizeObserver | null>(null)
  const viewportRef = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (element === null || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const style = window.getComputedStyle(element)
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      setMinHeight(Math.max(0, element.clientHeight - padding - PREVIOUS_TURN_PEEK))
    }
    observer.current = new ResizeObserver(measure)
    observer.current.observe(element)
    measure()
  }, [])
  return { viewportRef, minHeight }
}

export function Transcript({
  chat,
  snapshot,
  empty,
}: {
  readonly chat: ShellChat
  readonly snapshot: ChatSnapshot
  /** Shown before the first message. */
  readonly empty: ReactNode
}): ReactNode {
  const { messages, status } = snapshot
  const waiting = status === 'submitted' && messages.at(-1)?.role === 'user'
  const turns = turnsOf(messages)
  const { viewportRef, minHeight } = useLastTurnHeight()
  const stopped = useStopped(chat)
  const idle = status === 'ready' || status === 'error'
  const lastId = messages.at(-1)?.id

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller data-slot="chat-transcript" className="min-h-0 flex-1">
        <MessageScrollerViewport ref={viewportRef} className="px-4 py-3">
          {/* Tecton pads each item by 0.25rem for its focus rings, so gap-2 keeps turns 1rem apart. */}
          <MessageScrollerContent className="gap-2" aria-busy={status === 'streaming'}>
            {messages.length === 0 && (
              <MessageScrollerItem messageId="empty">{empty}</MessageScrollerItem>
            )}
            {turns.map((turn, index) => (
              <MessageScrollerItem
                key={turn.id}
                messageId={turn.id}
                scrollAnchor={turn.asked}
                data-slot="chat-turn"
                className="flex flex-col gap-4"
                style={
                  index === turns.length - 1 && minHeight !== undefined
                    ? ({ minHeight } satisfies CSSProperties)
                    : undefined
                }
              >
                {turn.messages.map(message =>
                  message.role === 'user' ? (
                    <Fragment key={message.id}>
                      <RenderBoundary
                        fallback={<NotShown>This message could not be shown.</NotShown>}
                      >
                        <UserMessage chat={chat} message={message} />
                      </RenderBoundary>
                      {/* Stopped before any reply arrived: said under the question. */}
                      {stopped.has(message.id) && message.id === lastId && <StoppedNote />}
                    </Fragment>
                  ) : message.role === 'assistant' ? (
                    <RenderBoundary
                      key={message.id}
                      fallback={<NotShown>This reply could not be shown.</NotShown>}
                    >
                      <AssistantMessage
                        chat={chat}
                        message={message}
                        last={message.id === lastId}
                        idle={idle}
                        stopped={stopped.has(message.id)}
                      />
                    </RenderBoundary>
                  ) : null,
                )}
                {waiting && index === turns.length - 1 && (
                  <Marker role="status">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>Thinking…</MarkerContent>
                  </Marker>
                )}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
