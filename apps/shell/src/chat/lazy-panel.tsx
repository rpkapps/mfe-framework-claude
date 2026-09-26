/**
 * Where the chat renders: an aside beside the mounted App on a wide screen, resizable, and a sheet
 * on a narrow one. The page is always the split's first panel and the aside is added after it, so
 * opening, closing and resizing the chat never remounts the App. These are on the boot path and
 * cost next to nothing; the panel inside them, the conversation and the agent client load the first
 * time the chat opens (`LazyShellChat`).
 */

import {
  Component,
  lazy,
  Suspense,
  use,
  useCallback,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { Sheet, SheetTitle } from '@tecton/react/components/sheet'
import {
  AppShellMain,
  AppShellSplit,
  AppShellSplitHandle,
  AppShellSplitPanel,
} from '@tecton/react/tecton/app-shell'
import { Panel, PanelActions, PanelHeader, PanelTitle } from '@tecton/react/tecton/panel'
import { XIcon } from 'lucide-react'

import { useAssistantWidth, useIsCompact } from '../shell/hooks.ts'

import { useChatPanel, useShellChat } from './panel-hooks.ts'
import type { LazyShellChat } from './instance.ts'
import { ASSISTANT_BUTTON_ID } from './panel.ts'

interface FrameProps {
  readonly onClose: () => void
}

/** How the aside is sized, for the panel's full-width button; the sheet has none. */
export interface ChatWidth {
  readonly wide: boolean
  readonly toggleWide: () => void
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

function Loaded({
  chat,
  onClose,
  width,
}: FrameProps & {
  readonly chat: LazyShellChat
  readonly width?: ChatWidth | undefined
}): ReactNode {
  // Both downloads start before either suspends, rather than the panel's after the chat's.
  chat.preload()
  return <ChatPanel chat={use(chat.load())} onClose={onClose} width={width} />
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
  width,
}: FrameProps & { readonly chat: LazyShellChat; readonly width?: ChatWidth }): ReactNode {
  return (
    <LoadBoundary onClose={onClose}>
      <Suspense fallback={<Loading onClose={onClose} />}>
        <Loaded chat={chat} onClose={onClose} width={width} />
      </Suspense>
    </LoadBoundary>
  )
}

type PanelHandle =
  NonNullable<ComponentProps<typeof AppShellSplitPanel>['panelRef']> extends Ref<infer T>
    ? NonNullable<T>
    : never

/** The aside's width until the user picks one, and what Enter or a double-click goes back to. */
const DEFAULT_WIDTH = '26rem'
/** The least the page keeps, dragged or full width, in rem: the App's own navigation and a column. */
const PAGE_MIN_REM = 30

function remInPixels(): number {
  return Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16
}
/**
 * The handle and the aside, mounted as the chat opens, so the width it starts at is read then: the
 * panel's size is its own from there, and writing the width back as it changes moves nothing.
 */
function AssistantPanel({
  chat,
  aside,
  remembered,
  width,
}: {
  readonly chat: LazyShellChat
  readonly aside: RefObject<PanelHandle | null>
  readonly remembered: number | null
  readonly width: ChatWidth
}): ReactNode {
  const [initial] = useState(() => remembered ?? DEFAULT_WIDTH)
  const reset = (): void => {
    aside.current?.resize(DEFAULT_WIDTH)
  }

  return (
    <>
      <AppShellSplitHandle
        aria-label="Resize the assistant"
        // The library's own double-click goes back to `initial`, the remembered width.
        disableDoubleClick
        onDoubleClick={reset}
        onKeyDown={event => {
          if (event.key === 'Enter') reset()
        }}
      />
      <AppShellSplitPanel
        id="assistant"
        panelRef={aside}
        defaultSize={initial}
        minSize="20rem"
        groupResizeBehavior="preserve-pixel-size"
      >
        <aside
          data-slot="chat-aside"
          aria-label="Assistant"
          className="flex h-full min-h-0 w-full flex-col bg-card"
        >
          <LazyChatPanel
            chat={chat}
            width={width}
            onClose={() => {
              chat.panel.hide()
              // Not a dialog, so nothing hands focus back: it goes to the button that opens it again.
              document.getElementById(ASSISTANT_BUTTON_ID)?.focus()
            }}
          />
        </aside>
      </AppShellSplitPanel>
    </>
  )
}

/**
 * The page and, on a wide screen while the chat is open, the aside beside it with a handle between
 * them. The aside keeps its width in pixels when the window changes, starts at the width the user
 * last chose, and goes back to the default with Enter or a double-click on the handle.
 */
export function ChatSplit({ children }: { readonly children: ReactNode }): ReactNode {
  const chat = useShellChat()
  const panel = useChatPanel(chat)
  const compact = useIsCompact()
  const aside = useRef<PanelHandle | null>(null)
  const group = useRef<HTMLDivElement | null>(null)
  const narrower = useRef<number | undefined>(undefined)
  const [wide, setWide] = useState(false)
  const [width, setWidth] = useAssistantWidth()
  const open = !compact && panel.open && chat !== null

  const toggleWide = useCallback(() => {
    const handle = aside.current
    if (handle === null) return
    if (wide) {
      handle.resize(narrower.current ?? DEFAULT_WIDTH)
    } else {
      narrower.current = handle.getSize().inPixels
      // As wide as the page's minimum lets it be.
      handle.resize('100%')
    }
  }, [wide])

  return (
    <AppShellSplit
      elementRef={group}
      onLayoutChanged={() => {
        const size = aside.current?.getSize()
        const across = group.current?.getBoundingClientRect().width
        if (size === undefined || across === undefined) return
        // `inPixels` is still the size before this change here; the percentage is already the new one.
        const pixels = Math.round((size.asPercentage / 100) * across)
        const isWide = across - pixels <= PAGE_MIN_REM * remInPixels() + 2
        setWide(isWide)
        // Full width is a moment, not a preference: the width to come back to stays the dragged one.
        if (!isWide && pixels !== width) setWidth(pixels)
      }}
    >
      <AppShellSplitPanel id="page" minSize={`${String(PAGE_MIN_REM)}rem`}>
        <AppShellMain className="flex">{children}</AppShellMain>
      </AppShellSplitPanel>
      {open && (
        <AssistantPanel chat={chat} aside={aside} remembered={width} width={{ wide, toggleWide }} />
      )}
    </AppShellSplit>
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
