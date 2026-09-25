/**
 * Where the chat renders: an aside beside the mounted App on a wide screen, a sheet on a narrow
 * one. The aside is a sibling after the main area, so opening it never remounts the App. These are
 * on the boot path and cost next to nothing; the panel inside them, the conversation and the agent
 * client load the first time the chat opens (`LazyShellChat`).
 */

import { Component, lazy, Suspense, use, type ReactNode } from 'react'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { Sheet, SheetTitle } from '@tecton/react/components/sheet'
import { Panel, PanelActions, PanelHeader, PanelTitle } from '@tecton/react/tecton/panel'
import { XIcon } from 'lucide-react'

import { useIsCompact } from '../shell/hooks.ts'

import { useChatPanel, useShellChat } from './panel-hooks.ts'
import type { LazyShellChat } from './instance.ts'
import { ASSISTANT_BUTTON_ID } from './panel.ts'

interface FrameProps {
  readonly onClose: () => void
}

/** The panel's header alone, while the chat loads, when it cannot, and when there is none. */
function Frame({ onClose, children }: FrameProps & { readonly children: ReactNode }): ReactNode {
  return (
    <Panel data-slot="chat-panel" variant="flat" className="h-full min-h-0 rounded-none">
      <PanelHeader>
        <PanelTitle>Assistant</PanelTitle>
        <PanelActions>
          <Button variant="ghost" size="icon-sm" aria-label="Close the assistant" onPress={onClose}>
            <XIcon />
          </Button>
        </PanelActions>
      </PanelHeader>
      {children}
    </Panel>
  )
}

function Loading({ onClose }: FrameProps): ReactNode {
  return (
    <Frame onClose={onClose}>
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading the assistant…
      </p>
    </Frame>
  )
}

/** A fresh lazy component for each try, since `lazy` keeps a failed load for good. */
function lazyChatPanel() {
  return lazy(async () => ({ default: (await import('./chat-panel.tsx')).ChatPanel }))
}

let ChatPanel = lazyChatPanel()

function Loaded({ chat, onClose }: FrameProps & { readonly chat: LazyShellChat }): ReactNode {
  // Both downloads start before either suspends, rather than the panel's after the chat's.
  chat.preload()
  return <ChatPanel chat={use(chat.load())} onClose={onClose} />
}

interface LoadBoundaryState {
  readonly failed: boolean
}

/** A chunk that did not arrive leaves the panel saying so, with a retry, not the shell broken. */
class LoadBoundary extends Component<
  FrameProps & { readonly children: ReactNode },
  LoadBoundaryState
> {
  override state: LoadBoundaryState = { failed: false }

  static getDerivedStateFromError(): LoadBoundaryState {
    return { failed: true }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <Frame onClose={this.props.onClose}>
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyTitle>The assistant could not be loaded</EmptyTitle>
            <EmptyDescription>Check the connection, then try again.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                ChatPanel = lazyChatPanel()
                this.setState({ failed: false })
              }}
            >
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      </Frame>
    )
  }
}

function LazyChatPanel({
  chat,
  onClose,
}: FrameProps & { readonly chat: LazyShellChat }): ReactNode {
  return (
    <LoadBoundary onClose={onClose}>
      <Suspense fallback={<Loading onClose={onClose} />}>
        <Loaded chat={chat} onClose={onClose} />
      </Suspense>
    </LoadBoundary>
  )
}

/** The aside, beside the main area; rendered only on a wide screen, while the chat is open. */
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
      <LazyChatPanel
        chat={chat}
        onClose={() => {
          chat.panel.hide()
          // Not a dialog, so nothing hands focus back: it goes to the button that opens it again.
          document.getElementById(ASSISTANT_BUTTON_ID)?.focus()
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
        if (!open) chat.panel.hide()
      }}
      side="right"
      showCloseButton={false}
      className="w-full p-0 sm:max-w-md"
    >
      <SheetTitle className="sr-only">Assistant</SheetTitle>
      <LazyChatPanel
        chat={chat}
        onClose={() => {
          chat.panel.hide()
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
      <Frame
        onClose={() => {
          onOpenChange(false)
        }}
      >
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyTitle>The assistant is not configured</EmptyTitle>
            <EmptyDescription>
              This deployment names no agent backend. Set AGENT_URL in the shell’s runtime
              configuration to the address that takes its AG-UI runs.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Frame>
    </Sheet>
  )
}
