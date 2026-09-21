/**
 * One tile: a Widget from another container, mounted inside the shell. The shell cannot reach
 * into the Widget, so everything crossing the line does so as inputs in and declared events out.
 */

import { memo, type ReactNode } from 'react'
import { DynamicWidget, type NeutralRegistryEntry } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tecton/react/components/dropdown-menu'
import { Skeleton } from '@tecton/react/components/skeleton'
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelHeader,
  PanelTitle,
} from '@tecton/react/tecton/panel'
import {
  CheckIcon,
  GripVerticalIcon,
  MoreVerticalIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'

import { summarizeInputs } from './input-schema.ts'
import { TILE_SPANS, type DashboardTile, type TileSpan } from './layout-store.ts'

/** Twelve-column canvas. Static strings, because Tailwind cannot see a built name. */
const SPAN_CLASS: Record<TileSpan, string> = {
  4: 'lg:col-span-4',
  6: 'lg:col-span-6',
  8: 'lg:col-span-8',
  12: 'lg:col-span-12',
}

export interface TileProps {
  readonly tile: DashboardTile
  readonly entry: NeutralRegistryEntry | undefined
  readonly onConfigure: () => void
  readonly onRemove: () => void
  readonly onSpanChange: (span: TileSpan) => void
  readonly onEvent: (event: string, payload: unknown) => void
  readonly onDragStart: () => void
  readonly onDropBefore: () => void
}

export function Tile({
  tile,
  entry,
  onConfigure,
  onRemove,
  onSpanChange,
  onEvent,
  onDragStart,
  onDropBefore,
}: TileProps): ReactNode {
  return (
    <div
      className={`col-span-12 flex ${SPAN_CLASS[tile.span]}`}
      onDragOver={event => {
        event.preventDefault()
      }}
      onDrop={event => {
        event.preventDefault()
        onDropBefore()
      }}
    >
      <Panel className="w-full">
        <PanelHeader
          draggable
          onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move'
            onDragStart()
          }}
          className="cursor-grab active:cursor-grabbing"
        >
          <GripVerticalIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <PanelTitle>{entry?.title ?? tile.widgetId}</PanelTitle>
          {/* `min-w-0` lets this shrink before the title does: a flex item's default minimum is its content. */}
          <span
            title={summarizeInputs(tile.inputs)}
            className="hidden min-w-0 shrink truncate font-mono text-xs text-muted-foreground sm:block"
          >
            {summarizeInputs(tile.inputs)}
          </span>
          <PanelActions>
            <Button variant="ghost" size="icon-sm" aria-label="Change inputs" onPress={onConfigure}>
              <SlidersHorizontalIcon />
            </Button>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon-sm" aria-label="Tile options">
                <MoreVerticalIcon />
              </Button>
              <DropdownMenu placement="bottom end" className="min-w-52">
                {TILE_SPANS.map(span => (
                  <DropdownMenuItem
                    key={span}
                    textValue={`Width ${String(span)} of 12`}
                    onAction={() => {
                      onSpanChange(span)
                    }}
                  >
                    {span === tile.span ? <CheckIcon /> : <span className="size-4" />}
                    Width {span} / 12
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem textValue="Remove" variant="destructive" onAction={onRemove}>
                  <Trash2Icon /> Remove from dashboard
                </DropdownMenuItem>
              </DropdownMenu>
            </DropdownMenuTrigger>
          </PanelActions>
        </PanelHeader>

        {/* The height floor is on the fallback rather than here, or a genuinely small Widget would be padded out to the largest thing the canvas might mount. */}
        <PanelContent>
          {entry === undefined ? (
            <MissingEntry widgetId={tile.widgetId} />
          ) : (
            <MountedWidget tile={tile} onEvent={onEvent} />
          )}
        </PanelContent>
      </Panel>
    </div>
  )
}

/** Shaped like the thing that is coming rather than a centred spinner, so the tile occupies the same room before and after. */
function MountingSkeleton(): ReactNode {
  return (
    <div role="status" aria-label="Loading the Widget" className="flex min-h-56 flex-col gap-3">
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-3/5" />
      <Skeleton className="h-28 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-16" />
      </div>
    </div>
  )
}

/** Memoized on the tile, so typing in the input dialog does not re-render every mount on the canvas. */
const MountedWidget = memo(function TileWidget({
  tile,
  onEvent,
}: {
  readonly tile: DashboardTile
  readonly onEvent: (event: string, payload: unknown) => void
}): ReactNode {
  return (
    <DynamicWidget
      widgetId={tile.widgetId}
      {...tile.inputs}
      /* The shell was never compiled against this Widget and knows its events only as strings, so it subscribes to all of them. */
      onEvent={onEvent}
      pending={<MountingSkeleton />}
      fallback={({ error, retry }) => (
        <div role="alert" className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-destructive">
            <TriangleAlertIcon className="size-4" />
            <span className="text-sm font-medium">{error.code}</span>
          </div>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{error.message}</p>
          <div>
            <Button variant="outline" size="sm" onPress={retry}>
              <RotateCcwIcon /> Retry
            </Button>
          </div>
        </div>
      )}
    />
  )
})

/** A saved dashboard outlives the registry that produced it, and a tile that silently vanished would look like data loss. */
function MissingEntry({ widgetId }: { readonly widgetId: string }): ReactNode {
  return (
    <div role="alert" className="flex items-start gap-2">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-surface-foreground" />
      <div className="flex flex-col items-start gap-1">
        <Badge variant="warning">not in the registry</Badge>
        <p className="text-sm text-muted-foreground">
          This dashboard was saved when <code className="font-mono">{widgetId}</code> was
          registered. It is not in the registry now — its container may be unregistered, renamed, or
          quarantined. Open the registry to check, or remove the tile.
        </p>
      </div>
    </div>
  )
}
