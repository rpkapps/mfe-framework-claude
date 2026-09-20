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
import { dockStyle, handleSide, isHorizontal, SIDES, sizeFromPointer } from './dock.ts'
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

/**
 * A rule on the one edge that faces the page.
 *
 * `flat` has no border of its own, and a shadow alone left the panel and the
 * app sharing an edge with nothing on it — on a light theme especially, the
 * two surfaces simply ran together. Only the docked edge gets one: the other
 * three are against the viewport.
 */
const EDGE_BORDER: Readonly<Record<DevtoolsSide, string>> = {
  top: 'border-b',
  right: 'border-l',
  bottom: 'border-t',
  left: 'border-r',
}

export function DevtoolsPanel(): ReactNode {
  const state = useSyncExternalStore(devtools.subscribe, devtools.getSnapshot, devtools.getSnapshot)
  const active = useActiveOverrides()

  /*
   * The trigger is the way in, not a toggle that stays put: a panel docked
   * bottom or left covers the corner it sits in, so leaving it rendered meant a
   * button underneath the panel that could be neither seen nor pressed. The
   * header's close button is the way out.
   */
  return state.open ? (
    <DevtoolsDock side={state.side} size={state.size} tab={state.tab} />
  ) : (
    <DevtoolsTrigger hasOverrides={active.size > 0} />
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
  const overlays = useOverlayLayer()

  return (
    <PortalProvider container={overlays}>
      <Panel
        variant="flat"
        size="sm"
        aria-label="MFE developer tools"
        data-mfe-devtools-panel
        data-side={side}
        style={dockStyle(side, size)}
        className={`@container fixed inset-0 z-[2147483000] rounded-none border-border shadow-2xl max-sm:!inset-0 max-sm:!h-auto max-sm:!w-auto sm:inset-auto ${EDGE_BORDER[side]}`}
      >
        <ResizeHandle side={side} />

        {/*
         * The tabs wrap the whole panel so their list can sit in the header,
         * beside the title, where a panel this short cannot afford to spend a
         * row on navigation. `Tabs` only requires that the list and the panes
         * share an ancestor; it does not require them to be siblings.
         */}
        <Tabs
          selectedKey={tab}
          onSelectionChange={key => {
            devtools.setTab(String(key) as DevtoolsTab)
          }}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <PanelHeader className="gap-2 border-b border-border-subtle">
            <PanelTitle className="flex items-center gap-2 text-sm">
              <WrenchIcon aria-hidden className="size-4 text-muted-foreground" />
              {/* The name goes before the controls do: a narrow dock needs the
                tabs and the close button more than it needs the label. */}
              <span className="@max-md:hidden">MFE devtools</span>
            </PanelTitle>

            {/*
             * The height is set through the same variant the component sets it
             * with. `TabsList` carries `group-data-horizontal/tabs:h-11`, which
             * out-specifies a plain `h-7` and left the header 16px taller than
             * the controls in it.
             *
             * Below 32rem of panel the labels go `sr-only` and the icons carry
             * the tabs. A 420px side dock — the default for left and right —
             * cannot hold a 198px tab strip, a dock control and a close button
             * at once, and the alternative is the dock control collapsing into
             * a menu on exactly the docks where moving the panel is what you
             * came to do. `sr-only` rather than `hidden`, so the tabs keep
             * their names.
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
             * A real toolbar, and used for the thing it is for.
             *
             * The dock control is an `OverflowItem` carrying its own menu form,
             * so a narrow dock moves it into the "more" menu and the header
             * stays one row. Registering it is what makes that possible: the
             * store writes the row's minimum size as an inline `min-inline-size`
             * from its *fixed* children, so a toolbar of nothing but fixed
             * children cannot shrink — it reported 188px into a 167px slot and
             * wrapped the close button onto a second line, which is the one
             * outcome an overflow row exists to avoid.
             *
             * The close button stays unwrapped, which is how this component
             * spells "never leaves the row", and the menu is placed by hand so
             * it sits before the close rather than after it.
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
          </PanelContent>
        </Tabs>
      </Panel>
    </PortalProvider>
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
