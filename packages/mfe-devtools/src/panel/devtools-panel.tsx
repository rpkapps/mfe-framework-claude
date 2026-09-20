/**
 * The trigger and the docked panel — everything in the lazy chunk.
 *
 * The trigger sits bottom-left. Bottom-right belongs to the shell's toaster,
 * and a developer tool that covers the notification telling you what just
 * failed is worse than no developer tool.
 *
 * The body only exists while the panel is open: closing unmounts it rather than
 * hiding it, so nothing subscribes and nothing is retained. Nothing here polls,
 * buffers events or keeps a history.
 */

import { useCallback, useRef, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react'
import { Button } from '@tecton/react/components/button'
import { Separator } from '@tecton/react/components/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import { ToggleGroup, ToggleGroupItem } from '@tecton/react/components/toggle-group'
import {
  LayersIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PanelTopIcon,
  SlidersHorizontalIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react'

import type { DevtoolsSide, DevtoolsTab } from '../devtools-settings.ts'
import { devtools } from '../devtools-store.ts'
import { dockStyle, handleSide, isHorizontal, SIDES, sizeFromPointer } from './dock.ts'
import { OverridesTab } from './overrides-tab.tsx'
import { RegistryTab } from './registry-tab.tsx'
import { useActiveOverrides } from './use-devtools.ts'

const SIDE_ICON: Readonly<Record<DevtoolsSide, typeof PanelTopIcon>> = {
  top: PanelTopIcon,
  right: PanelRightIcon,
  bottom: PanelBottomIcon,
  left: PanelLeftIcon,
}

const SIDE_LABEL: Readonly<Record<DevtoolsSide, string>> = {
  top: 'Dock to the top',
  right: 'Dock to the right',
  bottom: 'Dock to the bottom',
  left: 'Dock to the left',
}

export function DevtoolsPanel(): ReactNode {
  const state = useSyncExternalStore(devtools.subscribe, devtools.getSnapshot, devtools.getSnapshot)
  const inForce = useActiveOverrides()

  /*
   * The trigger is the way in, not a toggle that stays put: a panel docked
   * bottom or left covers the corner it sits in, so leaving it rendered meant a
   * button underneath the panel that could be neither seen nor pressed. The
   * header's close button is the way out.
   */
  return state.open ? (
    <DevtoolsDock side={state.side} size={state.size} tab={state.tab} />
  ) : (
    <DevtoolsTrigger hasOverrides={inForce.size > 0} />
  )
}

/**
 * The round button. It reports an active override with a dot rather than a
 * count: the number is in the panel and on the shell's own notice strip, and a
 * badge that has to be read is a worse affordance than a mark that has to be
 * noticed.
 */
function DevtoolsTrigger({ hasOverrides }: { readonly hasOverrides: boolean }): ReactNode {
  return (
    <Button
      variant="secondary"
      size="icon"
      aria-label="Open the developer tools"
      aria-expanded={false}
      data-mfe-devtools-trigger
      className="fixed bottom-4 left-4 z-[2147483000] size-11 rounded-full shadow-lg ring-1 ring-border-subtle"
      onPress={() => {
        devtools.toggle()
      }}
    >
      <WrenchIcon />
      {hasOverrides ? (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-warning ring-2 ring-background"
        />
      ) : null}
    </Button>
  )
}

/**
 * Below `sm` the dock is the whole viewport whatever side is chosen: a 28rem
 * drawer on a 375px screen leaves no room for the thing it contains, and the
 * side is a desktop preference rather than a phone one.
 */
function DevtoolsDock({
  side,
  size,
  tab,
}: {
  readonly side: DevtoolsSide
  readonly size: number
  readonly tab: DevtoolsTab
}): ReactNode {
  return (
    <section
      aria-label="MFE developer tools"
      data-mfe-devtools-panel
      data-side={side}
      style={dockStyle(side, size)}
      className="@container fixed inset-0 z-[2147483000] flex flex-col border-border-subtle bg-card text-card-foreground shadow-2xl max-sm:!inset-0 max-sm:!h-auto max-sm:!w-auto sm:inset-auto"
    >
      <ResizeHandle side={side} />

      <header className="flex h-10 shrink-0 items-center gap-x-3 border-b border-border-subtle px-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <WrenchIcon aria-hidden className="size-4 text-muted-foreground" />
          MFE devtools
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <ToggleGroup
            aria-label="Panel position"
            selectionMode="single"
            size="sm"
            selectedKeys={[side]}
            onSelectionChange={keys => {
              const next = [...keys][0]
              if (typeof next === 'string') devtools.setSide(next as DevtoolsSide)
            }}
            className="max-sm:hidden"
          >
            {SIDES.map(candidate => {
              const Icon = SIDE_ICON[candidate]
              return (
                <ToggleGroupItem key={candidate} id={candidate} aria-label={SIDE_LABEL[candidate]}>
                  <Icon />
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>

          <Separator orientation="vertical" className="h-4 max-sm:hidden" />

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close the developer tools"
            onPress={() => {
              devtools.close()
            }}
          >
            <XIcon />
          </Button>
        </div>
      </header>

      <Tabs
        selectedKey={tab}
        onSelectionChange={key => {
          devtools.setTab(String(key) as DevtoolsTab)
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList variant="line" aria-label="Developer tools" className="shrink-0 px-3">
          <TabsTrigger id="overrides">
            <SlidersHorizontalIcon /> Overrides
          </TabsTrigger>
          <TabsTrigger id="registry">
            <LayersIcon /> Registry
          </TabsTrigger>
        </TabsList>

        {/*
         * The panes do not scroll; each tab does, so a tab with a pinned
         * footer can keep it out of the scrolling region instead of floating
         * it over the rows with a translucent background.
         */}
        <TabsContent id="overrides" className="flex min-h-0 flex-1 flex-col">
          <OverridesTab />
        </TabsContent>
        <TabsContent id="registry" className="min-h-0 flex-1 overflow-y-auto p-3">
          <RegistryTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}

/**
 * Drag to resize.
 *
 * Pointer capture rather than window listeners: the element that started the
 * drag keeps receiving the moves once the pointer leaves it, so there is
 * nothing to register on `window` and nothing to forget to remove. A tool that
 * leaked a `pointermove` listener per drag would be an odd thing to ship in a
 * package whose job is making a page easier to reason about.
 */
function ResizeHandle({ side }: { readonly side: DevtoolsSide }): ReactNode {
  const dragging = useRef(false)
  const horizontal = isHorizontal(side)
  const edge = handleSide(side)

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      const viewport = horizontal ? window.innerHeight : window.innerWidth
      const position = horizontal ? event.clientY : event.clientX
      devtools.setSize(sizeFromPointer(side, position, viewport))
    },
    [horizontal, side],
  )

  const placement = horizontal
    ? `inset-x-0 h-1.5 cursor-row-resize ${edge === 'top' ? 'top-0' : 'bottom-0'}`
    : `inset-y-0 w-1.5 cursor-col-resize ${edge === 'left' ? 'left-0' : 'right-0'}`

  return (
    <div
      role="separator"
      aria-label="Resize the developer tools"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      data-edge={edge}
      className={`absolute z-10 touch-none transition-colors hover:bg-primary/40 max-sm:hidden ${placement}`}
      onPointerDown={event => {
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={event => {
        dragging.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    />
  )
}
