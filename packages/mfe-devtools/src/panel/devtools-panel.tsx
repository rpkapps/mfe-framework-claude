/**
 * The trigger and the docked panel — everything in the lazy chunk. The trigger sits bottom-left
 * because bottom-right belongs to the shell's toaster, and closing unmounts the body rather than
 * hiding it, so nothing subscribes and nothing is retained.
 */

import { useCallback, useRef, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react'
import { Button } from '@tecton/react/components/button'
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelHeader,
  PanelTitle,
} from '@tecton/react/tecton/panel'
import { DropdownMenuItem, DropdownMenuLabel } from '@tecton/react/components/dropdown-menu'
import { PortalProvider } from '@tecton/react/tecton/portal'
import { OverflowDivider, OverflowItem, OverflowMenu, Toolbar } from '@tecton/react/tecton/overflow'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import { ToggleGroup, ToggleGroupItem } from '@tecton/react/components/toggle-group'
import {
  CheckIcon,
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
import { dockStyle, handleSide, handleStyle, isHorizontal, SIDES, sizeFromPointer } from './dock.ts'
import { useOverlayLayer } from './overlay-layer.ts'
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

/** `flat` has no border of its own, and a shadow alone let the panel and the app run together. */
const EDGE_BORDER: Readonly<Record<DevtoolsSide, string>> = {
  top: 'border-b',
  right: 'border-l',
  bottom: 'border-t',
  left: 'border-r',
}

export function DevtoolsPanel(): ReactNode {
  const state = useSyncExternalStore(devtools.subscribe, devtools.getSnapshot, devtools.getSnapshot)
  const active = useActiveOverrides()

  // A panel docked bottom or left covers the corner, so a trigger left rendered could not be pressed.
  return state.open ? (
    <DevtoolsDock side={state.side} size={state.size} tab={state.tab} />
  ) : (
    <DevtoolsTrigger hasOverrides={active.size > 0} />
  )
}

/** A dot rather than a count: the number is in the panel, and a badge has to be read where a mark is noticed. */
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

/** Below `sm` the dock is the whole viewport whatever side is chosen, because the side is a desktop preference. */
function DevtoolsDock({
  side,
  size,
  tab,
}: {
  readonly side: DevtoolsSide
  readonly size: number
  readonly tab: DevtoolsTab
}): ReactNode {
  const overlays = useOverlayLayer()

  return (
    <PortalProvider container={overlays}>
      <ResizeHandle side={side} size={size} />

      <Panel
        variant="flat"
        size="sm"
        aria-label="MFE developer tools"
        data-mfe-devtools-panel
        data-side={side}
        style={dockStyle(side, size)}
        className={`@container fixed inset-0 z-[2147483000] rounded-none border-border shadow-2xl max-sm:!inset-0 max-sm:!h-auto max-sm:!w-auto sm:inset-auto ${EDGE_BORDER[side]}`}
      >
        {/* Wrapped so the list can sit in the header: `Tabs` needs an ancestor in common, not siblings. */}
        <Tabs
          selectedKey={tab}
          onSelectionChange={key => {
            devtools.setTab(String(key) as DevtoolsTab)
          }}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          {/* `PanelHeader` draws its own bottom border; naming one here repainted it. */}
          <PanelHeader className="gap-2">
            <PanelTitle className="flex items-center gap-2 text-sm">
              <WrenchIcon aria-hidden className="size-4 text-muted-foreground" />
              {/* A narrow dock needs the tabs and the close button more than it needs the label. */}
              <span className="@max-md:hidden">MFE devtools</span>
            </PanelTitle>

            {/*
             * `TabsList` carries `group-data-horizontal/tabs:h-11`, which out-specifies a plain
             * `h-7`. The labels go `sr-only` on a narrow dock, which cannot hold a 198px tab strip,
             * a dock control and a close button at once.
             */}
            <TabsList
              variant="default"
              aria-label="Developer tools"
              className="shrink-0 p-0.5 group-data-horizontal/tabs:h-7"
            >
              <TabsTrigger id="overrides">
                <SlidersHorizontalIcon />
                <span className="@max-lg:sr-only">Overrides</span>
              </TabsTrigger>
              <TabsTrigger id="registry">
                <LayersIcon />
                <span className="@max-lg:sr-only">Registry</span>
              </TabsTrigger>
            </TabsList>

            {/*
             * Registering the dock control is what lets a narrow header move it into the menu: the
             * row's minimum size is measured from its *fixed* children, so a toolbar of nothing but
             * fixed children reported 188px into a 167px slot and wrapped the close button.
             */}
            <PanelActions>
              <Toolbar aria-label="Developer tools panel" menu={false}>
                <OverflowItem
                  id="dock"
                  label="Panel position"
                  labelBehavior="keep"
                  className="max-sm:hidden"
                  overflow={
                    <>
                      <DropdownMenuLabel>Panel position</DropdownMenuLabel>
                      {SIDES.map(candidate => {
                        const Icon = SIDE_ICON[candidate]
                        return (
                          <DropdownMenuItem
                            key={candidate}
                            id={candidate}
                            onAction={() => {
                              devtools.setSide(candidate)
                            }}
                          >
                            <Icon />
                            {SIDE_LABEL[candidate]}
                            {candidate === side ? (
                              <CheckIcon aria-hidden className="ml-auto size-4" />
                            ) : null}
                          </DropdownMenuItem>
                        )
                      })}
                    </>
                  }
                >
                  <ToggleGroup
                    aria-label="Panel position"
                    selectionMode="single"
                    size="sm"
                    selectedKeys={[side]}
                    onSelectionChange={keys => {
                      const next = [...keys][0]
                      if (typeof next === 'string') devtools.setSide(next as DevtoolsSide)
                    }}
                  >
                    {SIDES.map(candidate => {
                      const Icon = SIDE_ICON[candidate]
                      return (
                        <ToggleGroupItem
                          key={candidate}
                          id={candidate}
                          aria-label={SIDE_LABEL[candidate]}
                        >
                          <Icon />
                        </ToggleGroupItem>
                      )
                    })}
                  </ToggleGroup>
                </OverflowItem>

                <OverflowDivider />
                <OverflowMenu label="More panel actions" />

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
              </Toolbar>
            </PanelActions>
          </PanelHeader>

          <PanelContent className="flex min-h-0 flex-1 flex-col p-0">
            {/* The panes do not scroll; each tab does, so a pinned footer stays out of the scrolling region. */}
            <TabsContent id="overrides" className="flex min-h-0 flex-1 flex-col">
              <OverridesTab />
            </TabsContent>
            <TabsContent id="registry" className="min-h-0 flex-1 overflow-y-auto p-3">
              <RegistryTab />
            </TabsContent>
          </PanelContent>
        </Tabs>
      </Panel>
    </PortalProvider>
  )
}

/**
 * Pointer capture rather than window listeners: the element that started the drag keeps receiving
 * the moves, so there is nothing to register on `window` and nothing to forget to remove.
 */
function ResizeHandle({
  side,
  size,
}: {
  readonly side: DevtoolsSide
  readonly size: number
}): ReactNode {
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

  // The panel draws the line along this edge; the handle contributes the grip and a target wider
  // than the line — the same shape `ResizableHandle` makes. It is `fixed` on the seam rather than
  // a child of the panel, which clips its overflow and would cut a grip in half.
  const placement = horizontal ? 'h-1.5 cursor-row-resize' : 'w-1.5 cursor-col-resize'

  return (
    <div
      role="separator"
      aria-label="Resize the developer tools"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      data-edge={edge}
      style={handleStyle(side, size)}
      className={`fixed z-[2147483001] flex touch-none items-center justify-center max-sm:hidden ${placement}`}
      onPointerDown={event => {
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={event => {
        dragging.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    >
      <div className={`shrink-0 rounded-lg bg-border ${horizontal ? 'h-1 w-6' : 'h-6 w-1'}`} />
    </div>
  )
}
