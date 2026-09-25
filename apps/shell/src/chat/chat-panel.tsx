/**
 * The chat panel: the transcript, the pending questions and the composer, over the page's one
 * `ShellChat`, which outlives it, so opening, closing and resizing lose nothing. It is loaded with
 * the chat, on first use; the aside and the sheet it renders in are on the boot path
 * (`lazy-panel.tsx`).
 */

import { useEffect, useMemo, type ReactNode } from 'react'
import { HOST_SCOPE, type AgentSuggestionEntry } from '@company/mfe-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { Tooltip, TooltipTrigger } from '@tecton/react/components/tooltip'
import {
  Composer,
  ComposerAttachments,
  ComposerCommands,
  ComposerField,
  ComposerHint,
  ComposerInput,
  ComposerStatusMessage,
  ComposerSubmit,
  ComposerSuggestion,
  ComposerSuggestions,
  ComposerToolbar,
  useComposer,
} from '@tecton/react/tecton/composer'
import {
  Panel,
  PanelActions,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from '@tecton/react/tecton/panel'
import {
  BotIcon,
  InfoIcon,
  SquarePenIcon,
  TextQuoteIcon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react'

import { Interrupts } from './approvals.tsx'
import { actionAttachment, chatCommands } from './commands.ts'
import { useAgentActions, useChatSnapshot, useOfferedSuggestions } from './hooks.ts'
import { useChatPanel } from './panel-hooks.ts'
import type { ChatAttachment } from './panel.ts'
import type { ShellChat } from './shell-chat.ts'
import { Transcript } from './transcript.tsx'

/** The shell's own prompts to start from, before the first message; the mounted Apps add theirs. */
const STARTERS: readonly AgentSuggestionEntry[] = [
  'What can you do on this page?',
  'Summarise what I’m looking at',
  'Where can I go from here?',
].map(message => ({ message, submit: true, definitionId: HOST_SCOPE }))

/** Puts the caret in the composer when the chat asks, which only a part inside `Composer` can. */
function FocusOnRequest({ chat }: { readonly chat: ShellChat }): null {
  const { focus } = useComposer()
  const { focusRequest } = useChatPanel(chat)
  useEffect(() => {
    if (chat.panel.takeFocusRequest(focusRequest)) focus()
  }, [chat, focusRequest, focus])
  return null
}

const ATTACHMENT_ICONS: Readonly<Record<ChatAttachment['kind'], LucideIcon>> = {
  quote: TextQuoteIcon,
  action: ZapIcon,
  context: InfoIcon,
}

function ChatComposer({ chat }: { readonly chat: ShellChat }): ReactNode {
  const snapshot = useChatSnapshot(chat)
  const panel = useChatPanel(chat)
  const offered = useOfferedSuggestions()
  const actions = useAgentActions()
  const commands = useMemo(() => chatCommands(actions), [actions])
  // Before the first message, and after each answer while nothing waits on the user.
  const idle = snapshot.status === 'ready' && snapshot.interrupts.length === 0
  const suggestions =
    snapshot.messages.length === 0 ? [...offered, ...STARTERS] : idle ? offered : []

  return (
    <Composer
      status={snapshot.status}
      value={panel.draft}
      onValueChange={draft => {
        chat.panel.setDraft(draft)
      }}
      onSubmit={({ text }) => {
        void chat.send(text)
      }}
      onStop={chat.client.stop}
      onRecallLast={() => chat.lastSent()}
    >
      {suggestions.length > 0 && (
        <ComposerSuggestions
          aria-label={snapshot.messages.length === 0 ? 'Ways to start' : 'Suggestions'}
        >
          {suggestions.map(suggestion => (
            <ComposerSuggestion
              key={`${suggestion.definitionId}:${suggestion.message}`}
              value={suggestion.label ?? suggestion.message}
              onSelect={() => {
                chat.offer(suggestion)
              }}
            />
          ))}
        </ComposerSuggestions>
      )}
      <ComposerField>
        <ComposerAttachments
          items={panel.attachments.map(attachment => {
            const Icon = ATTACHMENT_ICONS[attachment.kind]
            return {
              id: attachment.id,
              label: attachment.label,
              description: attachment.description,
              icon: <Icon aria-hidden />,
            }
          })}
          onRemove={id => {
            chat.panel.detach(String(id))
          }}
        />
        <ComposerCommands
          items={commands}
          onCommand={(item, composer) => {
            const command = commands.find(candidate => candidate.id === item.id)
            if (command?.action === undefined) {
              chat.newConversation()
              return
            }
            chat.panel.attach(actionAttachment(command.action))
            // Enter sends it as it is; the user may add what the action should act on.
            composer.setValue(`${command.label} `)
          }}
        />
        <ComposerInput placeholder="Ask the assistant, or type / for commands…" />
        <ComposerToolbar>
          <ComposerSubmit />
        </ComposerToolbar>
      </ComposerField>
      <ComposerHint isVisible={false} />
      <ComposerStatusMessage />
      <FocusOnRequest chat={chat} />
    </Composer>
  )
}

function StartHere(): ReactNode {
  return (
    <Empty className="border-0 p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon />
        </EmptyMedia>
        <EmptyTitle>Ask the assistant</EmptyTitle>
        <EmptyDescription>
          It sees where you are and what you selected, uses the actions on this page, and asks
          before it changes anything. Select text and press ⌘I to ask about it.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** The chat itself, loaded on first use into the aside or the sheet (`lazy-panel.tsx`). */
export function ChatPanel({
  chat,
  onClose,
}: {
  readonly chat: ShellChat
  readonly onClose: () => void
}): ReactNode {
  const snapshot = useChatSnapshot(chat)

  return (
    <Panel data-slot="chat-panel" variant="flat" className="h-full min-h-0 rounded-none">
      <PanelHeader className="gap-2">
        <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <PanelTitle>Assistant</PanelTitle>
        <PanelActions>
          <TooltipTrigger>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New conversation"
              onPress={() => {
                chat.newConversation()
              }}
            >
              <SquarePenIcon />
            </Button>
            <Tooltip>New conversation</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close the assistant"
              onPress={onClose}
            >
              <XIcon />
            </Button>
            <Tooltip>Close</Tooltip>
          </TooltipTrigger>
        </PanelActions>
      </PanelHeader>

      <Transcript chat={chat} snapshot={snapshot} empty={<StartHere />} />

      <PanelFooter className="flex-col items-stretch gap-2 border-t-0">
        <Interrupts interrupts={snapshot.interrupts} />
        {snapshot.error !== undefined && (
          <Alert variant="destructive" appearance="outline">
            <AlertTitle>The assistant could not answer</AlertTitle>
            <AlertDescription>{snapshot.error.message}</AlertDescription>
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
        )}
        <ChatComposer chat={chat} />
      </PanelFooter>
    </Panel>
  )
}
