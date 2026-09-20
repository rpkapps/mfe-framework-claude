// @ts-nocheck
'use client'

import * as React from 'react'
import { cn } from 'cn'
import { CheckIcon, ChevronDownIcon, SparklesIcon } from 'lucide-react'

import { Bubble, BubbleContent } from '@tecton/react/components/bubble'
import { Button } from '@tecton/react/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@tecton/react/components/collapsible'
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

import type { AgentAction, AgentMessage } from '../data'

/** Button variant for each action colour; a completed action is outlined in success. */
const actionVariant = {
  primary: 'default',
  default: 'secondary',
  success: 'default',
} as const

type AgentMessageListProps = React.ComponentProps<'div'> & {
  messages: AgentMessage[]
  /** Fired when an action chip on an assistant message is pressed. */
  onAction?: (action: AgentAction, message: AgentMessage) => void
  /** Ids of actions already taken (rendered as done). */
  completedActions?: string[]
  /** Renders a "thinking" indicator after the last message. */
  isBusy?: boolean
}

function AgentMessageList({
  className,
  messages,
  onAction,
  completedActions = [],
  isBusy = false,
  ...props
}: AgentMessageListProps) {
  return (
    <MessageScrollerProvider defaultScrollPosition="end">
      <MessageScroller
        data-slot="agent-message-list"
        className={cn('flex-1', className)}
        {...props}
      >
        <MessageScrollerViewport className="px-4 py-3">
          <MessageScrollerContent className="gap-4">
            {messages.map(message => (
              <MessageScrollerItem key={message.id} messageId={message.id}>
                {message.role === 'user' ? (
                  <UserMessage content={message.content} />
                ) : message.role === 'tool' ? (
                  <ToolActivity
                    summary={message.summary}
                    duration={message.duration}
                    steps={message.steps}
                  />
                ) : (
                  <AssistantMessage
                    content={message.content}
                    actions={message.actions}
                    completedActions={completedActions}
                    onAction={action => onAction?.(action, message)}
                  />
                )}
              </MessageScrollerItem>
            ))}
            {isBusy && (
              <MessageScrollerItem scrollAnchor>
                <div
                  data-slot="agent-busy"
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <Spinner className="size-3.5" />
                  Working…
                </div>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function AssistantMessage({
  content,
  actions,
  completedActions,
  onAction,
}: {
  content: string[]
  actions?: AgentAction[]
  completedActions: string[]
  onAction?: (action: AgentAction) => void
}) {
  return (
    <MessageGroup data-slot="agent-assistant-message">
      <Message>
        <MessageAvatar className="size-6 min-w-6 self-start bg-primary/20 text-primary-foreground">
          <SparklesIcon className="size-3.5" aria-hidden />
        </MessageAvatar>
        <MessageContent>
          <Bubble variant="ghost">
            <BubbleContent className="flex flex-col gap-2 leading-relaxed">
              {content.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      {actions && actions.length > 0 && (
        <div data-slot="agent-actions" className="flex flex-wrap justify-end gap-1.5 pl-8">
          {actions.map(action => {
            const done = completedActions.includes(action.id)
            return (
              <Button
                key={action.id}
                variant={done ? 'outline' : actionVariant[action.color ?? 'primary']}
                size="xs"
                className={cn(
                  'rounded-full',
                  done && 'border-success text-success',
                  !done && action.color === 'success' && 'bg-success text-success-foreground',
                )}
                isDisabled={done}
                onPress={() => onAction?.(action)}
              >
                {done && <CheckIcon />}
                {action.label}
              </Button>
            )
          })}
        </div>
      )}
    </MessageGroup>
  )
}

function UserMessage({ content }: { content: string }) {
  return (
    <Message align="end" data-slot="agent-user-message">
      <MessageContent>
        <Bubble variant="secondary" align="end">
          <BubbleContent>{content}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function ToolActivity({
  summary,
  duration,
  steps,
}: {
  summary: string
  duration: string
  steps: { id: string; label: string; detail?: string; duration: string }[]
}) {
  return (
    <Collapsible data-slot="agent-tool-activity" className="group/tool pl-8">
      <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
        {summary} · {duration}
        <ChevronDownIcon
          className="size-3.5 transition-transform group-data-expanded/tool:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 flex flex-col gap-1.5 border-l border-border-subtle pl-3 text-xs">
          {steps.map(step => (
            <li key={step.id} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="text-foreground">{step.label}</span>
                <span className="ml-auto font-mono text-muted-foreground tabular-nums">
                  {step.duration}
                </span>
              </span>
              {step.detail && <span className="text-muted-foreground">{step.detail}</span>}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

export { AgentMessageList, AssistantMessage, UserMessage, ToolActivity }
export type { AgentMessageListProps }
