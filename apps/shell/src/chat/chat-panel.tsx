/**
 * The chat surface: an aside beside the mounted App on a wide screen, a sheet on a narrow one.
 * Both render the same panel over the page's one `ShellChat`, which outlives them, so opening,
 * closing and resizing lose nothing. The aside is a sibling after the main area, so opening it
 * never remounts the App.
 */

import { useEffect, type ReactNode } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { Sheet, SheetTitle } from '@tecton/react/components/sheet'
import { Tooltip, TooltipTrigger } from '@tecton/react/components/tooltip'
import {
  Composer,
  ComposerAttachments,
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
import { BotIcon, SquarePenIcon, TextQuoteIcon, XIcon } from 'lucide-react'

import { useIsCompact } from '../shell/hooks.ts'

import { Interrupts } from './approvals.tsx'
import { useChatPanel, useChatSnapshot, useShellChat } from './hooks.ts'
import type { ShellChat } from './shell-chat.ts'
import { Transcript } from './transcript.tsx'

/** Prompts to start from, before the first message. */
const STARTERS = [
  'What can you do on this page?',
  'Summarise what I’m looking at',
  'Where can I go from here?',
] as const

/** Puts the caret in the composer when the chat asks, which only a part inside `Composer` can. */
function FocusOnRequest({ request }: { readonly request: number }): null {
  const { focus } = useComposer()
  useEffect(() => {
    if (request > 0) focus()
  }, [request, focus])
  return null
}

function ChatComposer({ chat }: { readonly chat: ShellChat }): ReactNode {
  const snapshot = useChatSnapshot(chat)
  const panel = useChatPanel(chat)

  return (
    <Composer
      status={snapshot.status}
      value={panel.draft}
      onValueChange={draft => {
        chat.setDraft(draft)
      }}
      onSubmit={({ text }) => {
        void chat.send(text)
      }}
      onStop={chat.client.stop}
      onRecallLast={() => chat.lastSent()}
    >
      {snapshot.messages.length === 0 && (
        <ComposerSuggestions aria-label="Ways to start">
          {STARTERS.map(starter => (
            <ComposerSuggestion key={starter} value={starter} submit />
          ))}
        </ComposerSuggestions>
      )}
      <ComposerField>
        <ComposerAttachments
          items={panel.attachments.map(attachment => ({
            id: attachment.id,
            label: attachment.label,
            description: attachment.description,
            icon: <TextQuoteIcon aria-hidden />,
          }))}
          onRemove={id => {
            chat.detach(String(id))
          }}
        />
        <ComposerInput placeholder="Ask the assistant…" />
        <ComposerToolbar>
          <ComposerSubmit />
        </ComposerToolbar>
      </ComposerField>
      <ComposerHint isVisible={false} />
      <ComposerStatusMessage />
      <FocusOnRequest request={panel.focusRequest} />
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

function ChatPanel({
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

function Unavailable({ onClose }: { readonly onClose: () => void }): ReactNode {
  return (
    <Panel data-slot="chat-panel" variant="flat" className="h-full rounded-none">
      <PanelHeader>
        <PanelTitle>Assistant</PanelTitle>
        <PanelActions>
          <Button variant="ghost" size="icon-sm" aria-label="Close the assistant" onPress={onClose}>
            <XIcon />
          </Button>
        </PanelActions>
      </PanelHeader>
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyTitle>The assistant is not configured</EmptyTitle>
          <EmptyDescription>
            This deployment names no agent backend. Set AGENT_URL in the shell’s runtime
            configuration to the address that takes its AG-UI runs.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent />
      </Empty>
    </Panel>
  )
}

/** The aside, beside the main area; rendered only on a wide screen. */
export function ChatAside(): ReactNode {
  const chat = useShellChat()
  const panel = useChatPanel(chat)
  const compact = useIsCompact()
  if (compact || !panel.open || chat === null) return null

  return (
    <aside
      data-slot="chat-aside"
      aria-label="Assistant"
      className="flex w-[26rem] shrink-0 flex-col border-l border-border-subtle bg-card"
    >
      <ChatPanel
        chat={chat}
        onClose={() => {
          chat.hide()
        }}
      />
    </aside>
  )
}

/** The sheet, over the page; rendered only on a narrow screen. */
export function ChatSheet(): ReactNode {
  const chat = useShellChat()
  const panel = useChatPanel(chat)
  const compact = useIsCompact()
  if (chat === null || !compact) return null

  return (
    <Sheet
      isOpen={panel.open}
      onOpenChange={open => {
        if (!open) chat.hide()
      }}
      side="right"
      showCloseButton={false}
      className="w-full p-0 sm:max-w-md"
    >
      <SheetTitle className="sr-only">Assistant</SheetTitle>
      <ChatPanel
        chat={chat}
        onClose={() => {
          chat.hide()
        }}
      />
    </Sheet>
  )
}

/** When no backend is configured, a sheet that says so, opened by the same button. */
export function ChatUnavailableSheet({
  isOpen,
  onOpenChange,
}: {
  readonly isOpen: boolean
  readonly onOpenChange: (open: boolean) => void
}): ReactNode {
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      side="right"
      showCloseButton={false}
      className="w-full p-0 sm:max-w-md"
    >
      <SheetTitle className="sr-only">Assistant</SheetTitle>
      <Unavailable
        onClose={() => {
          onOpenChange(false)
        }}
      />
    </Sheet>
  )
}
