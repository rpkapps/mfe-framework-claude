/**
 * The conversation, in Tecton's conversation components. The transcript is a `role="log"` that is
 * `aria-busy` while a reply streams, so a screen reader reads each reply once, complete; the
 * composer announces only its own changes.
 */

import type { ReactNode } from 'react'
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

import { splitQuote } from './quote.ts'
import type { ShellChat } from './shell-chat.ts'
import { ToolCallView } from './tool-call.tsx'

function textOf(message: UIMessage): string {
  return message.parts.flatMap(part => (part.type === 'text' ? [part.content] : [])).join('\n')
}

function UserMessage({ message }: { readonly message: UIMessage }): ReactNode {
  const { quoted, rest } = splitQuote(textOf(message))
  return (
    <Message align="end" data-slot="chat-user-message">
      <MessageContent>
        {quoted !== '' && (
          <blockquote className="max-w-[80%] self-end border-s-2 border-border ps-2 text-xs whitespace-pre-wrap text-muted-foreground">
            {quoted}
          </blockquote>
        )}
        {rest !== '' && (
          <Bubble variant="secondary" align="end">
            <BubbleContent className="whitespace-pre-wrap">{rest}</BubbleContent>
          </Bubble>
        )}
      </MessageContent>
    </Message>
  )
}

function AssistantMessage({
  chat,
  message,
}: {
  readonly chat: ShellChat
  readonly message: UIMessage
}): ReactNode {
  return (
    <Message data-slot="chat-assistant-message">
      <MessageAvatar className="size-6 min-w-6 self-start bg-primary/15 text-primary">
        <BotIcon className="size-3.5" aria-hidden />
      </MessageAvatar>
      <MessageContent>
        <MessageGroup>
          {message.parts.map((part, index) => {
            switch (part.type) {
              case 'text':
                return part.content === '' ? null : (
                  <Bubble key={index} variant="ghost">
                    <BubbleContent className="whitespace-pre-wrap">{part.content}</BubbleContent>
                  </Bubble>
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
                    <CollapsibleContent>
                      <p className="mt-1 border-s-2 ps-2 whitespace-pre-wrap">{part.content}</p>
                    </CollapsibleContent>
                  </Collapsible>
                )
              case 'tool-call':
                return <ToolCallView key={part.id} chat={chat} part={part} />
              case 'tool-result':
                // Folded into the call that asked for it.
                return null
            }
          })}
        </MessageGroup>
      </MessageContent>
    </Message>
  )
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

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller data-slot="chat-transcript" className="min-h-0 flex-1">
        <MessageScrollerViewport className="px-4 py-3">
          <MessageScrollerContent className="gap-4" aria-busy={status === 'streaming'}>
            {messages.length === 0 && (
              <MessageScrollerItem messageId="empty">{empty}</MessageScrollerItem>
            )}
            {messages.map(message => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === 'user'}
              >
                {message.role === 'user' ? (
                  <UserMessage message={message} />
                ) : message.role === 'assistant' ? (
                  <AssistantMessage chat={chat} message={message} />
                ) : null}
              </MessageScrollerItem>
            ))}
            {waiting && (
              <MessageScrollerItem messageId="waiting">
                <Marker role="status">
                  <MarkerIcon>
                    <Spinner />
                  </MarkerIcon>
                  <MarkerContent>Thinking…</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
