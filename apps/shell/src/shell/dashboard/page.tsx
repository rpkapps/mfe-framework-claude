/**
 * Compose a page out of Widgets that the shell was never built against.
 *
 * The shell knows three things about every tile on this canvas: an id, an input
 * schema and a list of event names, all read from the registry and none
 * compiled in. Adding a Widget here is a registry change, not a shell release.
 *
 * Drag one from the catalogue onto the canvas, give it its inputs, and it
 * mounts. Everything it emits appears in the activity feed, because a Widget's
 * events are as much a part of its contract as its props.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
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
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelHeader,
  PanelTitle,
} from '@tecton/react/tecton/panel'
import {
  ChevronDownIcon,
  LayersIcon,
  LayoutDashboardIcon,
  MousePointerClickIcon,
  Trash2Icon,
  ZapIcon,
} from 'lucide-react'

import { useDashboardLayout, useIsCompact } from '../hooks.ts'
import { ValueView } from '../readout.tsx'
import { Catalogue, WIDGET_MEDIA_TYPE } from './catalogue.tsx'
import { InputsDialog } from './inputs-dialog.tsx'
import { addTile, moveTile, tileKey, type DashboardTile, type TileSpan } from './layout-store.ts'
import { Tile } from './tile.tsx'

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
  // Stored, not this component's state: the palette adds a Widget and settings
  // clears the canvas, both from outside this page.
  const [{ tiles }, setLayout] = useDashboardLayout()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [events, setEvents] = useState<readonly WidgetEvent[]>([])
  const [isDropTarget, setIsDropTarget] = useState(false)
  /** The tile being dragged. A ref, because nothing renders differently for it. */
  const dragging = useRef<string | null>(null)

  const byId = useMemo(() => new Map(widgets.map(entry => [entry.id, entry] as const)), [widgets])

  const commit = useCallback(
    (next: readonly DashboardTile[]) => {
      setLayout({ tiles: next })
    },
    [setLayout],
  )

  /**
   * A Widget whose inputs are all optional or defaulted needs nothing from the
   * developer, so asking would be ceremony. One that needs an id is asked, or
   * it mounts straight into its own validation error.
   */
  const add = useCallback(
    (entry: NeutralRegistryEntry) => {
      if (needsInputPrompt(entry.contract)) {
        setEditing({ mode: 'add', entry })
        return
      }

      setLayout(layout =>
        addTile(layout, {
          key: tileKey(entry.id),
          widgetId: entry.id,
          inputs: defaultInputsFor(describeWidgetInputs(entry.contract)),
          span: 6,
        }),
      )
    },
    [setLayout],
  )

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

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 md:px-6">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderEyebrow>Shell · composition</PageHeaderEyebrow>
            {/* Wrapping, not truncating: the design system's title truncates
                to protect the actions beside it, and a page title is the one
                thing that must survive a phone. */}
            <PageHeaderTitle className="text-clip whitespace-normal">
              Widget dashboard
            </PageHeaderTitle>
            <PageHeaderDescription>
              Every Widget below is served by a different container on a different origin. The shell
              was not built against any of them: it reads their ids, their input schemas and their
              event names from the registry. Drag one onto the canvas to mount it.
            </PageHeaderDescription>
          </PageHeaderContent>
          <PageHeaderActions>
            <Button
              variant="outline"
              onPress={() => {
                devtools.open('registry')
              }}
            >
              <LayersIcon /> Registry
            </Button>
            {tiles.length === 0 ? null : (
              <Button
                variant="outline"
                onPress={() => {
                  commit([])
                }}
              >
                <Trash2Icon /> Clear canvas
              </Button>
            )}
          </PageHeaderActions>
        </PageHeader>

        {/*
         * Three regions, and which one is the page changes with the width: the
         * catalogue and the feed flank the canvas, then stack under it.
         *
         * `items-start`, and no `flex-1`: each column is as tall as its own
         * content. A shared row height sized by the viewport left the canvas
         * shorter than its tiles, and a tall Widget ran out through the border.
         */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <div className="lg:col-span-4 xl:col-span-3">
            <CataloguePanel widgets={widgets} onAdd={add} />
          </div>

          <section
            aria-label="Dashboard canvas"
            onDragOver={event => {
              event.preventDefault()
              event.dataTransfer.dropEffect = dragging.current === null ? 'copy' : 'move'
              setIsDropTarget(true)
            }}
            onDragLeave={() => {
              setIsDropTarget(false)
            }}
            onDrop={event => {
              event.preventDefault()
              setIsDropTarget(false)
              dragging.current = null

              const widgetId = event.dataTransfer.getData(WIDGET_MEDIA_TYPE)
              const entry = widgetId === '' ? undefined : byId.get(widgetId)
              if (entry !== undefined) add(entry)
            }}
            className={`min-h-96 rounded-xl border border-dashed p-3 transition-colors lg:col-span-8 xl:col-span-6 ${
              isDropTarget ? 'border-primary bg-primary/5' : 'border-border-subtle'
            }`}
          >
            {tiles.length === 0 ? (
              <EmptyCanvas hasWidgets={widgets.length > 0} />
            ) : (
              <div className="grid grid-cols-12 gap-3">
                {tiles.map(tile => (
                  <Tile
                    key={tile.key}
                    tile={tile}
                    entry={byId.get(tile.widgetId)}
                    onConfigure={() => {
                      const entry = byId.get(tile.widgetId)
                      if (entry !== undefined) setEditing({ mode: 'edit', entry, tile })
                    }}
                    onRemove={() => {
                      commit(tiles.filter(candidate => candidate.key !== tile.key))
                    }}
                    onSpanChange={(span: TileSpan) => {
                      commit(
                        tiles.map(candidate =>
                          candidate.key === tile.key ? { ...candidate, span } : candidate,
                        ),
                      )
                    }}
                    onEvent={(name, payload) => {
                      recordEvent(tile.widgetId, name, payload)
                    }}
                    onDragStart={() => {
                      dragging.current = tile.key
                    }}
                    onDropBefore={() => {
                      const from = dragging.current
                      dragging.current = null
                      if (from !== null) commit(moveTile(tiles, from, tile.key))
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          <div className="lg:col-span-12 xl:col-span-3">
            <ActivityFeed
              events={events}
              onClear={() => {
                setEvents([])
              }}
            />
          </div>
        </div>
      </div>

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
              addTile(layout, {
                key: tileKey(editing.entry.id),
                widgetId: editing.entry.id,
                inputs,
                span: 6,
              }),
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
 * The catalogue, and how much room it is allowed to take. In one column it is a
 * closed disclosure: five Widgets' worth of published contract above the canvas
 * puts the canvas off the bottom of a phone, and capping the list with a
 * scrollbar only sliced the last card in half.
 */
function CataloguePanel({
  widgets,
  onAdd,
}: {
  readonly widgets: readonly NeutralRegistryEntry[]
  readonly onAdd: (entry: NeutralRegistryEntry) => void
}): ReactNode {
  const isCompact = useIsCompact()
  const [isOpen, setIsOpen] = useState(false)
  const isExpanded = !isCompact || isOpen

  return (
    <Panel className="lg:max-h-[calc(100svh-18rem)]">
      <PanelHeader>
        <PanelTitle>Registered Widgets</PanelTitle>
        <PanelActions>
          <Badge variant="secondary" size="default">
            {widgets.length}
          </Badge>
          {isCompact ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={isOpen}
              aria-label={isOpen ? 'Hide the catalogue' : 'Show the catalogue'}
              onPress={() => {
                setIsOpen(current => !current)
              }}
            >
              <ChevronDownIcon className={isOpen ? 'rotate-180' : ''} />
            </Button>
          ) : null}
        </PanelActions>
      </PanelHeader>
      {isExpanded ? (
        <PanelContent>
          <Catalogue widgets={widgets} onAdd={onAdd} />
        </PanelContent>
      ) : null}
    </Panel>
  )
}

function EmptyCanvas({ hasWidgets }: { readonly hasWidgets: boolean }): ReactNode {
  return (
    <div className="flex h-full">
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
              <MousePointerClickIcon className="size-3.5" /> Tiles are reorderable, resizable and
              saved across reloads.
            </p>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  )
}

/**
 * What the Widgets emitted. A Widget's events are the half of its contract a
 * screenshot cannot show, so they are given a place on the page rather than a
 * console line.
 */
function ActivityFeed({
  events,
  onClear,
}: {
  readonly events: readonly WidgetEvent[]
  readonly onClear: () => void
}): ReactNode {
  return (
    <Panel className="xl:max-h-[calc(100svh-18rem)]">
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
        </PanelActions>
      </PanelHeader>
      <PanelContent className="max-h-96 xl:max-h-none">
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
                {/* Fields rather than a line of JSON: this panel is the only
                    place a Widget's events are visible at all. */}
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
