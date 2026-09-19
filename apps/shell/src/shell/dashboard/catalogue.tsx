/**
 * The catalogue of Widgets the registry advertises, as a drag source.
 *
 * Everything shown here — the id, the version, what it takes, what it emits —
 * is read from the registry entry. Nothing was fetched: no container has been
 * loaded at the point this list renders, which is exactly the property that
 * makes a catalogue possible at all.
 *
 * Dragging is not the only way in. A pointer gesture is unusable by keyboard
 * and awkward on a touch screen, so every row also has an Add button that does
 * the same thing.
 */

import type { ReactNode } from 'react'
import type { NeutralRegistryEntry } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { Tooltip, TooltipTrigger } from '@tecton/react/components/tooltip'
import { BoxIcon, GripVerticalIcon, PlusIcon, ZapIcon } from 'lucide-react'

import { readInputFields } from './input-schema.ts'

/** The drag payload. A custom type keeps unrelated drops out of the canvas. */
export const WIDGET_MEDIA_TYPE = 'application/x-mfe-widget'

export interface CatalogueProps {
  readonly widgets: readonly NeutralRegistryEntry[]
  readonly onAdd: (entry: NeutralRegistryEntry) => void
}

export function Catalogue({ widgets, onAdd }: CatalogueProps): ReactNode {
  if (widgets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-subtle">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BoxIcon />
            </EmptyMedia>
            <EmptyTitle>No Widgets registered</EmptyTitle>
            <EmptyDescription>
              Every entry in the registry is an App. A Widget appears here as soon as a container
              exports one.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Registered Widgets">
      {widgets.map(entry => (
        <CatalogueItem key={entry.id} entry={entry} onAdd={onAdd} />
      ))}
    </ul>
  )
}

function CatalogueItem({
  entry,
  onAdd,
}: {
  readonly entry: NeutralRegistryEntry
  readonly onAdd: (entry: NeutralRegistryEntry) => void
}): ReactNode {
  const fields = readInputFields(entry.contract)
  const events = entry.contract?.events ?? []

  return (
    <li
      draggable
      onDragStart={event => {
        event.dataTransfer.setData(WIDGET_MEDIA_TYPE, entry.id)
        // Some targets only ever see text/plain; giving it the id too means a
        // drop onto an editor or a terminal pastes something meaningful.
        event.dataTransfer.setData('text/plain', entry.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      className="group/widget flex cursor-grab items-start gap-2 rounded-lg border border-border-subtle bg-card p-3 transition-colors hover:border-border hover:bg-accent/40 active:cursor-grabbing"
    >
      <GripVerticalIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover/widget:text-foreground"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{entry.title ?? entry.id}</span>
          {entry.version === undefined ? null : (
            <span className="font-mono text-xs text-muted-foreground">{entry.version}</span>
          )}
          {entry.overridden === true ? (
            <Badge variant="warning" size="default">
              override
            </Badge>
          ) : null}
        </div>

        <p className="truncate font-mono text-xs text-muted-foreground">{entry.id}</p>

        <div className="flex flex-wrap items-center gap-1">
          {fields === null ? (
            <Badge variant="secondary" size="default">
              schema not published
            </Badge>
          ) : (
            fields.map(field => (
              <TooltipTrigger key={field.name}>
                <Badge
                  variant={field.required ? 'default' : 'secondary'}
                  render={props => <span {...props} tabIndex={0} />}
                >
                  {field.name}
                </Badge>
                <Tooltip>
                  {field.typeLabel}
                  {field.required ? ' · required' : ' · optional'}
                </Tooltip>
              </TooltipTrigger>
            ))
          )}
          {events.map(event => (
            <Badge key={event} variant="info" size="default">
              <ZapIcon /> {event}
            </Badge>
          ))}
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Add ${entry.title ?? entry.id} to the dashboard`}
        onPress={() => {
          onAdd(entry)
        }}
      >
        <PlusIcon />
      </Button>
    </li>
  )
}
