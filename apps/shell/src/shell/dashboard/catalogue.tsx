/**
 * The catalogue of Widgets the registry advertises: everything shown is read from the registry
 * entry, with no container loaded at the point this list renders (§16).
 *
 * A card is an icon and a name, because that is what someone picking a Widget reads. The
 * published contract is what the same person reads once they have picked one, so it sits behind
 * the card rather than under every name. Every card also has an Add button, because a pointer
 * gesture is unusable by keyboard.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { DefinitionIcon, type NeutralRegistryEntry } from '@company/mfe-react'
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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@tecton/react/components/input-group'
import { Popover, PopoverTrigger } from '@tecton/react/components/popover'
import { Tooltip, TooltipTrigger } from '@tecton/react/components/tooltip'
import { Chip, ChipGroup, ChipList } from '@tecton/react/tecton/chip'
import { BoxIcon, PlusIcon, SearchIcon, XIcon, ZapIcon } from 'lucide-react'

import { readInputFields, type InputField } from './input-schema.ts'

/** The drag payload. A custom type keeps unrelated drops out of the canvas. */
export const WIDGET_MEDIA_TYPE = 'application/x-mfe-widget'

export interface CatalogueProps {
  readonly widgets: readonly NeutralRegistryEntry[]
  readonly onAdd: (entry: NeutralRegistryEntry) => void
}

/** Name, id, description and tags: everything a reader might type to mean this Widget. */
function searchText(entry: NeutralRegistryEntry): string {
  return [entry.title ?? '', entry.id, entry.description ?? '', ...(entry.tags ?? [])]
    .join(' ')
    .toLowerCase()
}

export function Catalogue({ widgets, onAdd }: CatalogueProps): ReactNode {
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(new Set())

  // Every tag any Widget declares, in a stable order so the filter does not reshuffle as you type.
  const tags = useMemo(
    () =>
      [...new Set(widgets.flatMap(entry => entry.tags ?? []))].sort((a, b) => a.localeCompare(b)),
    [widgets],
  )

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return widgets.filter(entry => {
      if (needle !== '' && !searchText(entry).includes(needle)) return false
      if (selectedTags.size === 0) return true
      // Any rather than all: narrowing to the intersection of two tags usually empties the list.
      return (entry.tags ?? []).some(tag => selectedTags.has(tag))
    })
  }, [widgets, query, selectedTags])

  if (widgets.length === 0) {
    return (
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
    )
  }

  const isFiltered = query !== '' || selectedTags.size > 0

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <InputGroup>
        <InputGroupInput
          value={query}
          aria-label="Search Widgets"
          placeholder="Search Widgets…"
          onChange={event => {
            setQuery(event.target.value)
          }}
        />
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        {query === '' ? null : (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear the search"
              onPress={() => {
                setQuery('')
              }}
            >
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      {tags.length === 0 ? null : (
        <ChipGroup
          aria-label="Filter by tag"
          selectionMode="multiple"
          selectedKeys={selectedTags}
          onSelectionChange={keys => {
            setSelectedTags(keys === 'all' ? new Set(tags) : new Set([...keys].map(String)))
          }}
        >
          <ChipList className="flex flex-wrap gap-1.5">
            {tags.map(tag => (
              <Chip key={tag} id={tag} variant="secondary" appearance="outline">
                {tag}
              </Chip>
            ))}
          </ChipList>
        </ChipGroup>
      )}

      {matches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing matches</EmptyTitle>
            <EmptyDescription>
              No registered Widget matches this search and tag filter.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                setQuery('')
                setSelectedTags(new Set())
              }}
            >
              Clear the filter
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {isFiltered ? (
            <p className="text-xs text-muted-foreground" role="status">
              {matches.length} of {widgets.length} Widgets
            </p>
          ) : null}
          <ul className="flex flex-col gap-1.5" aria-label="Registered Widgets">
            {matches.map(entry => (
              <CatalogueItem key={entry.id} entry={entry} onAdd={onAdd} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function CatalogueItem({
  entry,
  onAdd,
}: {
  readonly entry: NeutralRegistryEntry
  readonly onAdd: (entry: NeutralRegistryEntry) => void
}): ReactNode {
  const name = entry.title ?? entry.id

  return (
    <li
      draggable
      onDragStart={event => {
        event.dataTransfer.setData(WIDGET_MEDIA_TYPE, entry.id)
        // Some targets only ever see text/plain, so a drop onto an editor pastes something meaningful.
        event.dataTransfer.setData('text/plain', entry.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      className="group/widget flex cursor-grab items-center gap-2.5 rounded-lg border border-border-subtle bg-card p-2 transition-colors hover:border-border hover:bg-accent/40 active:cursor-grabbing"
    >
      <WidgetIcon entry={entry} />

      {/* The name is the disclosure. A separate info button cost a third of the row's width in a
          panel this narrow, and the name had to truncate to two words to make room for it. */}
      <PopoverTrigger>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 flex-1 justify-start"
          aria-label={`${name}. What it takes and emits.`}
        >
          <span className="truncate">{name}</span>
        </Button>
        <Popover className="w-80 p-3">
          <ContractDetail entry={entry} />
        </Popover>
      </PopoverTrigger>

      {entry.overridden === true ? (
        <Badge variant="warning" appearance="outline">
          override
        </Badge>
      ) : null}

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Add ${name} to the dashboard`}
        onPress={() => {
          onAdd(entry)
        }}
      >
        <PlusIcon />
      </Button>
    </li>
  )
}

/** A parsed icon when the author declared one, and the id's initials when they did not. */
function WidgetIcon({ entry }: { readonly entry: NeutralRegistryEntry }): ReactNode {
  if (entry.icon !== undefined && typeof entry.icon !== 'string') {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
        <DefinitionIcon icon={entry.icon} size={18} />
      </span>
    )
  }

  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
      {typeof entry.icon === 'string' ? entry.icon : entry.id.slice(0, 3)}
    </span>
  )
}

/** The published contract, in two lines: inputs in, events out. */
function ContractDetail({ entry }: { readonly entry: NeutralRegistryEntry }): ReactNode {
  const fields = readInputFields(entry.contract)
  const events = entry.contract?.events ?? []

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs text-muted-foreground">
          {entry.id}
          {entry.version === undefined ? null : ` · ${entry.version}`}
        </span>
        {entry.description === undefined ? null : (
          <p className="text-sm text-muted-foreground">{entry.description}</p>
        )}
      </div>

      {entry.tags === undefined || entry.tags.length === 0 ? null : (
        <div className="flex flex-wrap gap-1">
          {entry.tags.map(tag => (
            <Badge key={tag} variant="secondary" appearance="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <Contract fields={fields} events={events} />
    </div>
  )
}

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
                <ZapIcon aria-hidden data-icon="inline-start" /> {event}
              </Badge>
            ))
          )}
        </dd>
      </div>
    </dl>
  )
}
