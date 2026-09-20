// @ts-nocheck
'use client'

import * as React from 'react'
import { cn } from 'cn'

import { Panel, PanelFooter } from '@tecton/react/tecton/panel'

import { AgentComposer } from './components/agent-composer'
import { AgentMessageList } from './components/agent-message-list'
import { AgentPanelHeader } from './components/agent-panel-header'
import { agentConversation, agentSuggestions, type AgentAction, type AgentMessage } from './data'

type AiAgentPanelProps = Omit<React.ComponentProps<typeof Panel>, 'children'> & {
  initialMessages?: AgentMessage[]
  suggestions?: string[]
  onClose?: () => void
}

/**
 * AI Agent side panel — header, scrolling conversation (assistant / user /
 * tool-activity messages with action chips) and a composer.
 */
function AiAgentPanel({
  className,
  initialMessages = agentConversation,
  suggestions = agentSuggestions,
  onClose,
  variant = 'flat',
  ...props
}: AiAgentPanelProps) {
  const [messages, setMessages] = React.useState<AgentMessage[]>(initialMessages)
  const [completed, setCompleted] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)

  const send = (text: string) => {
    setMessages(current => [...current, { id: `u-${Date.now()}`, role: 'user', content: text }])
    setBusy(true)
    window.setTimeout(() => {
      setMessages(current => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: [
            `I'll look into "${text}" and report back with the impact on cost, schedule and risk.`,
          ],
        },
      ])
      setBusy(false)
    }, 900)
  }

  const act = (action: AgentAction) => {
    setCompleted(current => [...current, action.id])
    send(action.label)
  }

  return (
    <Panel
      data-slot="ai-agent-panel"
      variant={variant}
      className={cn('h-full', className)}
      {...props}
    >
      <AgentPanelHeader
        onClose={onClose}
        onClear={() => {
          setMessages([])
          setCompleted([])
        }}
      />
      <AgentMessageList
        messages={messages}
        completedActions={completed}
        onAction={act}
        isBusy={busy}
      />
      <PanelFooter className="border-t-0 pt-0">
        <AgentComposer
          className="w-full"
          suggestions={messages.length === 0 ? suggestions : []}
          isDisabled={busy}
          onSubmit={send}
        />
      </PanelFooter>
    </Panel>
  )
}

/** Route-ready page: the agent panel docked on the right of an empty canvas. */
export default function AiAgentPanelPage() {
  return (
    <div
      data-slot="ai-agent-panel-page"
      className="flex h-svh w-full bg-background text-foreground"
    >
      <div className="hidden min-w-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground md:flex">
        Well design canvas
      </div>
      <aside className="flex h-full w-full max-w-md shrink-0 flex-col border-l border-border-subtle bg-card">
        <AiAgentPanel />
      </aside>
    </div>
  )
}

export { AiAgentPanel, AgentPanelHeader, AgentMessageList, AgentComposer }
export { agentConversation, agentSuggestions } from './data'
export type { AiAgentPanelProps }
export type { AgentMessage, AgentAction, AgentToolStep } from './data'
