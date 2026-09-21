/**
 * The catalogue of Widgets the registry advertises: everything shown is read from the registry
 * entry, with no container loaded at the point this list renders (§16). Every row also has an
 * Add button, because a pointer gesture is unusable by keyboard.
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

import { readInputFields, type InputField } from './input-schema.ts'

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
        // Some targets only ever see text/plain, so a drop onto an editor pastes something meaningful.
        event.dataTransfer.setData('text/plain', entry.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      className="group/widget flex cursor-grab items-start gap-2 rounded-lg border border-border-subtle bg-card p-2.5 transition-colors hover:border-border hover:bg-accent/40 active:cursor-grabbing"
    >
      <GripVerticalIcon
        aria-hidden
        className="mt-1 size-4 shrink-0 text-muted-foreground group-hover/widget:text-foreground"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* The id goes under the name rather than beside it: sharing one row truncated both strings and gave no whole identifier. */}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-medium">{entry.title ?? entry.id}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {entry.overridden === true ? (
                <Badge variant="warning" appearance="outline">
                  override
                </Badge>
              ) : null}
              {entry.version === undefined ? null : (
                <span className="font-mono text-xs text-muted-foreground">{entry.version}</span>
              )}
            </span>
          </div>
          <span className="truncate font-mono text-xs text-muted-foreground">{entry.id}</span>
        </div>

        {/* Two labelled lines rather than one run of coloured pills, which said nothing about which word was a prop and which an event. */}
        <Contract fields={fields} events={events} />
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Add ${entry.title ?? entry.id} to the dashboard`}
        className="opacity-70 transition-opacity group-hover/widget:opacity-100"
        onPress={() => {
          onAdd(entry)
        }}
      >
        <PlusIcon />
      </Button>
    </li>
  )
}

/** The published contract, in two lines: inputs in, events out. */
function Contract({
  fields,
  events,
}: {
  readonly fields: readonly InputField[] | null
  readonly events: readonly string[]
}): ReactNode {
  return (
    <dl className="flex flex-col gap-1 text-xs">
      <div className="flex min-w-0 gap-2">
        <dt className="w-12 shrink-0 pt-0.5 text-muted-foreground">Takes</dt>
        <dd className="flex min-w-0 flex-wrap gap-1">
          {fields === null ? (
            <span className="text-muted-foreground italic">no schema published</span>
          ) : fields.length === 0 ? (
            <span className="text-muted-foreground">nothing</span>
          ) : (
            fields.map(field => (
              <TooltipTrigger key={field.name}>
                <Badge
                  variant="outline"
                  render={props => <span {...props} tabIndex={0} />}
                  className={field.required ? 'border-border-strong' : 'text-muted-foreground'}
                >
                  {field.name}
                  {field.required ? <span aria-hidden>*</span> : null}
                </Badge>
                <Tooltip>
                  {field.typeLabel}
                  {field.required ? ' · required' : ' · optional'}
                </Tooltip>
              </TooltipTrigger>
            ))
          )}
        </dd>
      </div>

      <div className="flex min-w-0 gap-2">
        <dt className="w-12 shrink-0 pt-0.5 text-muted-foreground">Emits</dt>
        <dd className="flex min-w-0 flex-wrap gap-1">
          {events.length === 0 ? (
            <span className="text-muted-foreground">nothing</span>
          ) : (
            events.map(event => (
              <Badge key={event} variant="info" appearance="outline">
                <ZapIcon aria-hidden /> {event}
              </Badge>
            ))
          )}
        </dd>
      </div>
    </dl>
  )
}
