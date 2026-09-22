/**
 * One tile: a Widget from another container, mounted inside the shell. The shell cannot reach
 * into the Widget, so everything crossing the line does so as inputs in and declared events out.
 *
 * The tile owns its rectangle on the canvas. The pointer gestures are handed in rather than
 * started here, because a drag that began on this tile keeps running over every other one.
 */

import { memo, type ReactNode } from 'react'
import { DefinitionIcon, DynamicWidget, type RegistryEntry } from '@company/mfe-react'
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

import { pixelsFromCells, type Rect, type ResizeEdge } from './grid.ts'
import { summarizeInputs } from './input-schema.ts'
import type { DashboardTile } from './layout-store.ts'

/** The sizes worth one click. Anything between them is a drag. */
export const TILE_PRESETS = [
  { label: 'Small', w: 16, h: 10 },
  { label: 'Medium', w: 24, h: 14 },
  { label: 'Large', w: 36, h: 20 },
] as const

/** Which handle sits where. The corners come last so they take the press at an overlap. */
const HANDLES: readonly { readonly edge: ResizeEdge; readonly className: string }[] = [
  { edge: 'n', className: 'top-0 right-2 left-2 h-1.5 cursor-ns-resize' },
  { edge: 's', className: 'right-2 bottom-0 left-2 h-1.5 cursor-ns-resize' },
  { edge: 'w', className: 'top-2 bottom-2 left-0 w-1.5 cursor-ew-resize' },
  { edge: 'e', className: 'top-2 right-0 bottom-2 w-1.5 cursor-ew-resize' },
  { edge: 'nw', className: 'top-0 left-0 size-3 cursor-nwse-resize' },
  { edge: 'ne', className: 'top-0 right-0 size-3 cursor-nesw-resize' },
  { edge: 'sw', className: 'bottom-0 left-0 size-3 cursor-nesw-resize' },
  { edge: 'se', className: 'right-0 bottom-0 size-3 cursor-nwse-resize' },
]

export interface TileProps {
  readonly tile: DashboardTile
  readonly entry: RegistryEntry | undefined
  /** Where to draw it: the tile's own rectangle, or where a gesture in flight is taking it. */
  readonly rect: Rect
  readonly isMoving: boolean
  readonly onConfigure: () => void
  readonly onRemove: () => void
  readonly onResize: (size: { readonly w: number; readonly h: number }) => void
  readonly onEvent: (event: string, payload: unknown) => void
  readonly onMoveStart: (event: React.PointerEvent) => void
  readonly onResizeStart: (event: React.PointerEvent, edge: ResizeEdge) => void
  readonly onKeyDown: (event: React.KeyboardEvent) => void
}

export function Tile({
  tile,
  entry,
  rect,
  isMoving,
  onConfigure,
  onRemove,
  onResize,
  onEvent,
  onMoveStart,
  onResizeStart,
  onKeyDown,
}: TileProps): ReactNode {
  const name = entry?.title ?? tile.widgetId

  return (
    <div
      className={`absolute p-1.5 ${isMoving ? 'z-20' : 'z-10'}`}
      style={{
        left: pixelsFromCells(rect.x),
        top: pixelsFromCells(rect.y),
        width: pixelsFromCells(rect.w),
        height: pixelsFromCells(rect.h),
      }}
    >
      <Panel
        className={`h-full w-full transition-shadow ${isMoving ? 'shadow-lg ring-1 ring-primary' : ''}`}
      >
        {/* The whole header drags, which is where anyone reaches for a tile. It has to be this
            element rather than a Button inside it: React Aria runs a Button's props through
            `filterDOMProps`, which drops `onPointerDown` before it reaches the DOM. */}
        <PanelHeader
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={event => {
            // A press that landed on a control in the header belongs to that control.
            if ((event.target as Element).closest('button,a,input,select,[role="button"]') !== null)
              return
            onMoveStart(event)
          }}
        >
          {/* A plain element for the same reason, and focusable so the keyboard can place a tile. */}
          <span
            role="button"
            tabIndex={0}
            aria-label={`Move ${name}. Arrow keys move it, shift and arrow keys resize it.`}
            className="mt-0.5 shrink-0 rounded-sm text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            onPointerDown={onMoveStart}
            onKeyDown={onKeyDown}
          >
            <GripVerticalIcon aria-hidden className="size-4" />
          </span>
          {entry?.icon === undefined || typeof entry.icon === 'string' ? null : (
            <DefinitionIcon
              icon={entry.icon}
              size={16}
              className="shrink-0 text-muted-foreground"
            />
          )}
          <PanelTitle>{name}</PanelTitle>
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
                {TILE_PRESETS.map(preset => (
                  <DropdownMenuItem
                    key={preset.label}
                    textValue={preset.label}
                    onAction={() => {
                      onResize({ w: preset.w, h: preset.h })
                    }}
                  >
                    {preset.w === rect.w && preset.h === rect.h ? (
                      <CheckIcon />
                    ) : (
                      <span className="size-4" />
                    )}
                    {preset.label}
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

        <PanelContent>
          {entry === undefined ? (
            <MissingEntry widgetId={tile.widgetId} />
          ) : (
            <MountedWidget tile={tile} onEvent={onEvent} />
          )}
        </PanelContent>
      </Panel>

      {/* Outside the Panel, so a Widget that paints to its own edge cannot sit over them. */}
      {HANDLES.map(handle => (
        <span
          key={handle.edge}
          aria-hidden
          data-resize-edge={handle.edge}
          className={`absolute z-10 ${handle.className}`}
          onPointerDown={event => {
            onResizeStart(event, handle.edge)
          }}
        />
      ))}
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
          rejected. Open the registry to check, or remove the tile.
        </p>
      </div>
    </div>
  )
}
