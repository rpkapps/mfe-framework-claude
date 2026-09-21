/**
 * Compose a page out of Widgets the shell was never built against: it knows an id, an input
 * schema and a list of event names, all read from the registry. Adding a Widget here is a
 * registry change, not a shell release.
 *
 * The three columns fill the height they are given and the user decides how the width is split.
 * The catalogue and the activity feed collapse, because on a narrow screen the canvas is the
 * thing worth the room.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  defaultInputsFor,
  describeWidgetInputs,
  needsInputPrompt,
  useWidgets,
  type NeutralRegistryEntry,
} from '@company/mfe-react'
import { devtools } from '@company/mfe-devtools'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@tecton/react/components/resizable'
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelHeader,
  PanelTitle,
} from '@tecton/react/tecton/panel'
import { CanvasOverlay, CanvasToolbar } from '@tecton/react/tecton/canvas'
import { usePanelRef } from 'react-resizable-panels'
import {
  ChevronsLeftIcon,
  ChevronsRightIcon,
  LayersIcon,
  LayoutDashboardIcon,
  MousePointerClickIcon,
  Trash2Icon,
  ZapIcon,
} from 'lucide-react'

import { useDashboardLayout, useDashboardPanels, useIsCompact } from '../hooks.ts'
import { ValueView } from '../readout.tsx'
import { DashboardCanvas } from './canvas.tsx'
import { Catalogue, WIDGET_MEDIA_TYPE } from './catalogue.tsx'
import {
  canvasColumns,
  canvasRows,
  columnsIn,
  pixelsFromCells,
  resolveCollisions,
  type Rect,
} from './grid.ts'
import { InputsDialog } from './inputs-dialog.tsx'
import { addTile, NOMINAL_COLUMNS, placeTile, tileKey, type DashboardTile } from './layout-store.ts'
import { ACTIVITY_PANEL, CANVAS_PANEL, CATALOGUE_PANEL } from './panels-store.ts'
import { Tile } from './tile.tsx'
import { tileKeyboardMove, useTileDrag } from './use-tile-drag.ts'

interface WidgetEvent {
  readonly key: string
  readonly widgetId: string
  readonly name: string
  readonly payload: unknown
  readonly at: string
}

/** Which tile the dialog is editing, and whether confirming adds or updates it. */
type Editing =
  | { readonly mode: 'add'; readonly entry: NeutralRegistryEntry }
  | { readonly mode: 'edit'; readonly entry: NeutralRegistryEntry; readonly tile: DashboardTile }

const MAX_EVENTS = 40

export function DashboardPage(): ReactNode {
  const widgets = useWidgets()
  // Stored, not this component's state: the palette and settings both write it from outside.
  const [{ tiles }, setLayout] = useDashboardLayout()
  const [panels, setPanels] = useDashboardPanels()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [events, setEvents] = useState<readonly WidgetEvent[]>([])
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [placement, setPlacement] = useState('')
  const isCompact = useIsCompact()

  const surface = useRef<HTMLDivElement | null>(null)
  const cataloguePanel = usePanelRef()
  const activityPanel = usePanelRef()
  const [collapsed, setCollapsed] = useState({ catalogue: false, activity: false })

  const measured = useCanvasColumns(surface)

  const byId = useMemo(() => new Map(widgets.map(entry => [entry.id, entry] as const)), [widgets])

  /**
   * The surface is at least as wide as the window and as wide as its rightmost tile, so a layout
   * built on a monitor scrolls on a laptop instead of being squeezed into itself.
   */
  const columns = useMemo(
    () => canvasColumns(tiles, measured ?? NOMINAL_COLUMNS),
    [tiles, measured],
  )

  const commit = useCallback(
    (next: readonly DashboardTile[]) => {
      setLayout({ tiles: next })
    },
    [setLayout],
  )

  /** A Widget whose inputs are all optional or defaulted needs nothing from the developer, so asking would be ceremony (§28). */
  const add = useCallback(
    (entry: NeutralRegistryEntry) => {
      if (needsInputPrompt(entry.contract)) {
        setEditing({ mode: 'add', entry })
        return
      }

      setLayout(layout =>
        addTile(
          layout,
          {
            key: tileKey(entry.id),
            widgetId: entry.id,
            inputs: defaultInputsFor(describeWidgetInputs(entry.contract)),
          },
          columns,
        ),
      )
    },
    [setLayout, columns],
  )

  /** One path for every placement, so a drag, a keyboard nudge and a size preset all settle the same way. */
  const place = useCallback(
    (key: string, rect: Rect) => {
      setLayout(layout => ({
        tiles: resolveCollisions(placeTile(layout.tiles, key, rect), key),
      }))
      setPlacement(
        `Moved to column ${String(rect.x + 1)}, row ${String(rect.y + 1)}, ${String(rect.w)} by ${String(rect.h)} cells.`,
      )
    },
    [setLayout],
  )

  const drag = useTileDrag(columns, place)

  const recordEvent = useCallback((widgetId: string, name: string, payload: unknown) => {
    setEvents(current =>
      [
        {
          key: `${widgetId}:${name}:${String(Date.now())}:${Math.random().toString(36).slice(2, 6)}`,
          widgetId,
          name,
          payload,
          at: new Date().toLocaleTimeString(),
        },
        ...current,
      ].slice(0, MAX_EVENTS),
    )
  }, [])

  const catalogue = (
    <CataloguePanel
      widgets={widgets}
      onAdd={add}
      onCollapse={() => cataloguePanel.current?.collapse()}
    />
  )

  const activity = (
    <ActivityFeed
      events={events}
      onClear={() => {
        setEvents([])
      }}
      onCollapse={() => activityPanel.current?.collapse()}
    />
  )

  const canvas = (
    <DashboardCanvas
      label="Dashboard canvas"
      isDropTarget={isDropTarget}
      isGesturing={drag.gesture !== null}
      surfaceRef={surface}
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setIsDropTarget(true)
      }}
      onDragLeave={() => {
        setIsDropTarget(false)
      }}
      onDrop={event => {
        event.preventDefault()
        setIsDropTarget(false)
        const widgetId = event.dataTransfer.getData(WIDGET_MEDIA_TYPE)
        const entry = widgetId === '' ? undefined : byId.get(widgetId)
        if (entry !== undefined) add(entry)
      }}
      overlay={
        <>
          {/* Each restore control sits at the edge the panel collapsed into, so it reads as that
              panel rather than as a canvas tool. */}
          {collapsed.catalogue ? (
            <CanvasOverlay position="left">
              <CanvasToolbar orientation="vertical" aria-label="Catalogue">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Show the catalogue"
                  onPress={() => cataloguePanel.current?.expand()}
                >
                  <ChevronsRightIcon />
                </Button>
              </CanvasToolbar>
            </CanvasOverlay>
          ) : null}
          {collapsed.activity ? (
            <CanvasOverlay position="right">
              <CanvasToolbar orientation="vertical" aria-label="Activity">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Show the activity feed"
                  onPress={() => activityPanel.current?.expand()}
                >
                  <ChevronsLeftIcon />
                </Button>
              </CanvasToolbar>
            </CanvasOverlay>
          ) : null}
        </>
      }
    >
      {tiles.length === 0 ? (
        <EmptyCanvas hasWidgets={widgets.length > 0} />
      ) : (
        <div
          className="relative"
          style={{
            width: pixelsFromCells(columns),
            minHeight: pixelsFromCells(canvasRows(tiles)),
          }}
        >
          {tiles.map(tile => {
            const isMoving = drag.gesture?.key === tile.key
            return (
              <Tile
                key={tile.key}
                tile={tile}
                entry={byId.get(tile.widgetId)}
                rect={isMoving && drag.gesture !== null ? drag.gesture.rect : tile}
                isMoving={isMoving}
                onConfigure={() => {
                  const entry = byId.get(tile.widgetId)
                  if (entry !== undefined) setEditing({ mode: 'edit', entry, tile })
                }}
                onRemove={() => {
                  commit(tiles.filter(candidate => candidate.key !== tile.key))
                }}
                onResize={size => {
                  place(tile.key, { x: tile.x, y: tile.y, ...size })
                }}
                onEvent={(name, payload) => {
                  recordEvent(tile.widgetId, name, payload)
                }}
                onMoveStart={event => {
                  drag.startMove(event, tile.key, tile)
                }}
                onResizeStart={(event, edge) => {
                  drag.startResize(event, tile.key, tile, edge)
                }}
                onKeyDown={event => {
                  tileKeyboardMove(tile.key, tile, event, columns, place)
                }}
              />
            )
          })}
        </div>
      )}
    </DashboardCanvas>
  )

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3 p-3">
      <DashboardHeader
        hasTiles={tiles.length > 0}
        onClear={() => {
          commit([])
        }}
      />

      {/* One column below the breakpoint: a drag handle between panels is unusable on a phone. */}
      {isCompact ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {catalogue}
          <div className="flex min-h-96 flex-col">{canvas}</div>
          {activity}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1 gap-0"
          defaultLayout={panels}
          onLayoutChanged={(layout, meta) => {
            // Only what the user did: mount and constraint recomputes would overwrite their split.
            if (meta.isUserInteraction) setPanels(layout)
          }}
        >
          <ResizablePanel
            id={CATALOGUE_PANEL}
            panelRef={cataloguePanel}
            collapsible
            collapsedSize="0"
            minSize="14"
            maxSize="40"
            onResize={size => {
              setCollapsed(current =>
                current.catalogue === (size.asPercentage === 0)
                  ? current
                  : { ...current, catalogue: size.asPercentage === 0 },
              )
            }}
            className="flex min-h-0 flex-col"
          >
            {catalogue}
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1.5" />
          <ResizablePanel id={CANVAS_PANEL} minSize="30" className="flex min-h-0 flex-col">
            {canvas}
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1.5" />
          <ResizablePanel
            id={ACTIVITY_PANEL}
            panelRef={activityPanel}
            collapsible
            collapsedSize="0"
            minSize="14"
            maxSize="40"
            onResize={size => {
              setCollapsed(current =>
                current.activity === (size.asPercentage === 0)
                  ? current
                  : { ...current, activity: size.asPercentage === 0 },
              )
            }}
            className="flex min-h-0 flex-col"
          >
            {activity}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* A pointer drag shows where a tile went; a keyboard one has to say so. */}
      <p role="status" aria-live="polite" className="sr-only">
        {placement}
      </p>

      <InputsDialog
        key={
          editing === null
            ? 'closed'
            : `${editing.mode}:${editing.entry.id}:${editing.mode === 'edit' ? editing.tile.key : 'new'}`
        }
        entry={editing?.entry ?? null}
        current={editing?.mode === 'edit' ? editing.tile.inputs : {}}
        title={
          editing === null
            ? ''
            : `${editing.mode === 'add' ? 'Add' : 'Configure'} ${editing.entry.title ?? editing.entry.id}`
        }
        confirmLabel={editing?.mode === 'edit' ? 'Apply' : 'Add to dashboard'}
        onCancel={() => {
          setEditing(null)
        }}
        onConfirm={inputs => {
          if (editing === null) return
          if (editing.mode === 'add') {
            setLayout(layout =>
              addTile(
                layout,
                { key: tileKey(editing.entry.id), widgetId: editing.entry.id, inputs },
                columns,
              ),
            )
          } else {
            const target = editing.tile.key
            commit(tiles.map(tile => (tile.key === target ? { ...tile, inputs } : tile)))
          }
          setEditing(null)
        }}
      />
    </div>
  )
}

/**
 * The canvas decides how many columns there are, so it is measured rather than assumed. `null`
 * until it has a width: the first paint reports zero, and treating that as a real canvas would
 * fit every tile down to the minimum.
 */
function useCanvasColumns(surface: React.RefObject<HTMLDivElement | null>): number | null {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = surface.current
    if (element === null) return

    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [surface])

  return width === 0 ? null : columnsIn(width)
}

/** A strip rather than the old page header: the panels below it need the height. */
function DashboardHeader({
  hasTiles,
  onClear,
}: {
  readonly hasTiles: boolean
  readonly onClear: () => void
}): ReactNode {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h1 className="text-sm font-medium">Widget dashboard</h1>
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        Every Widget is served by a different container on a different origin, and the shell was
        built against none of them.
      </p>
      <Button
        variant="outline"
        size="sm"
        onPress={() => {
          devtools.open('registry')
        }}
      >
        <LayersIcon data-icon="inline-start" /> Registry
      </Button>
      {hasTiles ? (
        <Button variant="outline" size="sm" onPress={onClear}>
          <Trash2Icon data-icon="inline-start" /> Clear canvas
        </Button>
      ) : null}
    </div>
  )
}

function CataloguePanel({
  widgets,
  onAdd,
  onCollapse,
}: {
  readonly widgets: readonly NeutralRegistryEntry[]
  readonly onAdd: (entry: NeutralRegistryEntry) => void
  readonly onCollapse: () => void
}): ReactNode {
  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader>
        <PanelTitle>Widgets</PanelTitle>
        <PanelActions>
          <Badge variant="secondary" size="default">
            {widgets.length}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide the catalogue"
            className="hidden lg:inline-flex"
            onPress={onCollapse}
          >
            <ChevronsLeftIcon />
          </Button>
        </PanelActions>
      </PanelHeader>
      <PanelContent>
        <Catalogue widgets={widgets} onAdd={onAdd} />
      </PanelContent>
    </Panel>
  )
}

function EmptyCanvas({ hasWidgets }: { readonly hasWidgets: boolean }): ReactNode {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutDashboardIcon />
          </EmptyMedia>
          <EmptyTitle>Build a dashboard</EmptyTitle>
          <EmptyDescription>
            {hasWidgets
              ? 'Drag a Widget from the catalogue onto this canvas, or use its Add button. You will be asked for its inputs — the form comes from the schema that Widget’s own build published.'
              : 'Nothing is registered to drop here yet.'}
          </EmptyDescription>
        </EmptyHeader>
        {hasWidgets ? (
          <EmptyContent>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MousePointerClickIcon className="size-3.5" /> Tiles snap to the grid, and the layout
              is saved across reloads.
            </p>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  )
}

/** A Widget's events are the half of its contract a screenshot cannot show, so they get a place on the page rather than a console line. */
function ActivityFeed({
  events,
  onClear,
  onCollapse,
}: {
  readonly events: readonly WidgetEvent[]
  readonly onClear: () => void
  readonly onCollapse: () => void
}): ReactNode {
  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader>
        <PanelTitle>Activity</PanelTitle>
        <PanelActions>
          {events.length === 0 ? null : (
            <>
              <Badge variant="secondary" size="default">
                {events.length}
              </Badge>
              <Button variant="ghost" size="icon-sm" aria-label="Clear events" onPress={onClear}>
                <Trash2Icon />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide the activity feed"
            className="hidden lg:inline-flex"
            onPress={onCollapse}
          >
            <ChevronsRightIcon />
          </Button>
        </PanelActions>
      </PanelHeader>
      <PanelContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Acknowledge an alert, select a design — anything a Widget declares as an
            event arrives here, validated against its schema on the way out.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map(event => (
              <li
                key={event.key}
                className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-background/40 p-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <ZapIcon aria-hidden className="size-3.5 shrink-0 text-info" />
                  <span className="truncate text-sm font-medium">{event.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {event.at}
                  </span>
                </div>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {event.widgetId}
                </span>
                {/* Fields rather than a line of JSON: this panel is the only place a Widget's events are visible. */}
                <Payload payload={event.payload} />
              </li>
            ))}
          </ul>
        )}
      </PanelContent>
    </Panel>
  )
}

/** An event payload: named fields when it has them, one value when it does not. */
function Payload({ payload }: { readonly payload: unknown }): ReactNode {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    return (
      <div className="rounded-md border border-border-subtle bg-card px-2.5 py-1.5">
        <ValueView value={payload} />
      </div>
    )

  const entries = Object.entries(payload as Record<string, unknown>)
  if (entries.length === 0) return <span className="text-xs text-muted-foreground">no payload</span>

  return (
    <dl className="divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle bg-card">
      {entries.map(([name, value]) => (
        <div
          key={name}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-2.5 py-1.5"
        >
          <dt className="font-mono text-xs text-muted-foreground">{name}</dt>
          <dd className="min-w-0">
            <ValueView value={value} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
