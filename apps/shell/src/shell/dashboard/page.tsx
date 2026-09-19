/**
 * Compose a page out of Widgets that the shell was never built against.
 *
 * This is the framework's central claim made operable. The shell knows three
 * things about every tile on this canvas: an id, an input schema and a list of
 * event names — all of them read from the registry, none of them compiled in.
 * It has never imported any of these Widgets, it does not share a build with
 * them, and each one is served by a different origin. Adding a Widget to this
 * dashboard is a registry change, not a shell release.
 *
 * Drag a Widget from the catalogue onto the canvas, give it its inputs, and it
 * mounts. Everything it emits appears in the activity feed on the right,
 * because a Widget's events are as much a part of its contract as its props.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { NeutralRegistryEntry } from '@company/mfe-react'
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
import { ScrollArea } from '@tecton/react/components/scroll-area'
import { Separator } from '@tecton/react/components/separator'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import { Panel, PanelContent, PanelHeader, PanelTitle } from '@tecton/react/tecton/panel'
import { LayoutDashboardIcon, MousePointerClickIcon, Trash2Icon, ZapIcon } from 'lucide-react'

import { useWidgets } from '../hooks.ts'
import { Catalogue, WIDGET_MEDIA_TYPE } from './catalogue.tsx'
import { InputsDialog } from './inputs-dialog.tsx'
import { initialValues, readInputFields, toInputs } from './input-schema.ts'
import {
  dashboardStorage,
  moveTile,
  readLayout,
  tileKey,
  writeLayout,
  type DashboardTile,
  type TileSpan,
} from './layout-store.ts'
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
  const storage = useMemo(() => dashboardStorage(), [])
  const [tiles, setTiles] = useState<readonly DashboardTile[]>(() => readLayout(storage).tiles)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [events, setEvents] = useState<readonly WidgetEvent[]>([])
  const [isDropTarget, setIsDropTarget] = useState(false)
  /** The tile being dragged. A ref, because nothing renders differently for it. */
  const dragging = useRef<string | null>(null)

  const byId = useMemo(() => new Map(widgets.map(entry => [entry.id, entry] as const)), [widgets])

  const commit = useCallback(
    (next: readonly DashboardTile[]) => {
      setTiles(next)
      writeLayout(storage, { tiles: next })
    },
    [storage],
  )

  /**
   * A Widget whose inputs are all optional or defaulted needs nothing from the
   * developer, so asking would be ceremony. One that needs an id has to be
   * asked, or it mounts straight into its own validation error.
   */
  const add = useCallback(
    (entry: NeutralRegistryEntry) => {
      const fields = readInputFields(entry.contract)
      if (fields !== null && fields.every(field => !field.required)) {
        commit([
          ...tiles,
          {
            key: tileKey(entry.id),
            widgetId: entry.id,
            inputs: toInputs(fields, initialValues(fields, {})),
            span: 6,
          },
        ])
        return
      }
      setEditing({ mode: 'add', entry })
    },
    [commit, tiles],
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
            <PageHeaderTitle>Widget dashboard</PageHeaderTitle>
            <PageHeaderDescription>
              Every Widget below is served by a different container on a different origin. The shell
              was not built against any of them: it reads their ids, their input schemas and their
              event names from the registry. Drag one onto the canvas to mount it.
            </PageHeaderDescription>
          </PageHeaderContent>
          <PageHeaderActions>
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

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-3">
            <Panel>
              <PanelHeader>
                <PanelTitle>Registered Widgets</PanelTitle>
                <Badge variant="secondary" size="default">
                  {widgets.length}
                </Badge>
              </PanelHeader>
              <PanelContent>
                <Catalogue widgets={widgets} onAdd={add} />
              </PanelContent>
            </Panel>
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
            className={`min-h-96 rounded-xl border border-dashed p-3 transition-colors xl:col-span-6 ${
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

          <div className="xl:col-span-3">
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
            commit([
              ...tiles,
              { key: tileKey(editing.entry.id), widgetId: editing.entry.id, inputs, span: 6 },
            ])
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
    <Panel>
      <PanelHeader>
        <PanelTitle>Events</PanelTitle>
        {events.length === 0 ? null : (
          <Button variant="ghost" size="icon-sm" aria-label="Clear events" onPress={onClear}>
            <Trash2Icon />
          </Button>
        )}
      </PanelHeader>
      <PanelContent>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing yet. Acknowledge an alert, select a design — anything a Widget declares as an
            event arrives here, validated against its schema on the way out.
          </p>
        ) : (
          <ScrollArea>
            <ul className="flex max-h-96 flex-col overflow-y-auto">
              {events.map((event, index) => (
                <li key={event.key} className="flex flex-col gap-1 py-2">
                  {index === 0 ? null : <Separator emphasis="subtle" className="-mt-2 mb-1" />}
                  <div className="flex items-center gap-1.5">
                    <ZapIcon aria-hidden className="size-3.5 text-info-surface-foreground" />
                    <span className="truncate text-xs font-medium">{event.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                      {event.at}
                    </span>
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {event.widgetId}
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-xs">
                    {JSON.stringify(event.payload)}
                  </pre>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PanelContent>
    </Panel>
  )
}
