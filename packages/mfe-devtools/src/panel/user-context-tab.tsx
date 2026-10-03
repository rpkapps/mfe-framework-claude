import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@tecton/react/components/accordion'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@tecton/react/components/input-group'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@tecton/react/components/combobox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@tecton/react/tecton/panel'
import { DatabaseIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react'

import type {
  Json,
  UserContextInspectionEntry,
  UserContextStatus,
} from '@company/mfe-core/user-context'
import { useMfeRuntime } from '@company/mfe-react'

import { useUserContextInspection } from './use-user-context-inspection.ts'

const STATUS: Readonly<
  Record<
    UserContextStatus,
    { readonly label: string; readonly variant: 'secondary' | 'info' | 'success' | 'destructive' }
  >
> = {
  hydrating: { label: 'Hydrating', variant: 'info' },
  ready: { label: 'Ready', variant: 'success' },
  invalid: { label: 'Invalid', variant: 'destructive' },
}

export function UserContextTab(): ReactNode {
  const { userContext } = useMfeRuntime('the developer tools user-context view')
  const snapshot = useUserContextInspection(userContext?.inspection)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<string>()
  const navigation = useRef<HTMLElement>(null)
  const allEntries = useMemo(
    () => [...snapshot.entries].sort((a, b) => a.id.localeCompare(b.id)),
    [snapshot.entries],
  )
  const entries = useMemo(() => {
    const term = query.trim().toLowerCase()
    return allEntries.filter(
      entry =>
        entry.id.toLowerCase().includes(term) ||
        localKeys(entry).some(key => `${entry.id}:${key}`.toLowerCase().includes(term)),
    )
  }, [allEntries, query])
  const keys = useMemo(() => allEntries.map(entry => entry.id), [allEntries])
  const selected = allEntries.find(entry => entry.id === selection) ?? allEntries[0]
  const tabStop = entries.find(entry => entry === selected) ?? entries[0]

  if (!userContext)
    return (
      <StateEmpty
        title="User Context is not configured"
        description="Configure userContext on the shell runtime to inspect its owners and values."
      />
    )
  if (snapshot.disposed)
    return (
      <StateEmpty
        title="User Context runtime was disposed"
        description="Reload the shell to inspect the active runtime."
      />
    )
  if (snapshot.entries.length === 0)
    return (
      <StateEmpty
        title="No user-context owners loaded"
        description="Open an app or widget that declares userContext. An owner appears once its record loads."
      />
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Badge variant="success" appearance="outline">
          Live
        </Badge>
        <span className="text-xs text-muted-foreground">
          {snapshot.entries.length} owners · Read only
        </span>
      </div>
      {selected === undefined ? null : (
        <div className="shrink-0 border-b border-border p-2 @3xl:hidden">
          <Combobox
            items={keys}
            value={selected.id}
            onValueChange={value => {
              if (value !== null) setSelection(value)
            }}
          >
            <ComboboxTrigger
              render={<Button variant="outline" className="w-full min-w-0 justify-between" />}
              aria-label="Choose user-context owner"
            >
              <span className="min-w-0 truncate">
                <ComboboxValue />
              </span>
            </ComboboxTrigger>
            <ComboboxContent className="min-w-0">
              <ComboboxInput
                aria-label="Find a user-context owner"
                placeholder="Search owners…"
                showTrigger={false}
              />
              <ComboboxEmpty>No owners match your search.</ComboboxEmpty>
              <ComboboxList>
                {(key: string) => (
                  <ComboboxItem key={key} value={key}>
                    <span className="min-w-0 truncate" title={key}>
                      {key}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 @3xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col border-r border-border @3xl:flex">
          <div className="shrink-0 p-2">
            <InputGroup>
              <InputGroupInput
                aria-label="Search user-context owners"
                placeholder="Filter owners or keys…"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
              <InputGroupAddon align="inline-start">
                <SearchIcon data-icon="inline-start" />
              </InputGroupAddon>
            </InputGroup>
          </div>
          {entries.length === 0 ? (
            <StateEmpty
              title="No owners match your search"
              description="Search by owner ID or a namespaced key such as lab:units."
            />
          ) : (
            <nav
              ref={navigation}
              aria-label="User-context owners"
              className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1"
            >
              {entries.map((entry, index) => (
                <Button
                  key={entry.id}
                  variant={entry === selected ? 'secondary' : 'ghost'}
                  size="sm"
                  className="w-full min-w-0 justify-between"
                  aria-pressed={entry === selected}
                  aria-label={`Inspect ${entry.id}`}
                  title={entry.id}
                  tabIndex={entry === tabStop ? 0 : -1}
                  onClick={() => setSelection(entry.id)}
                  onKeyDown={event => {
                    const target =
                      event.key === 'ArrowDown'
                        ? Math.min(index + 1, entries.length - 1)
                        : event.key === 'ArrowUp'
                          ? Math.max(index - 1, 0)
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? entries.length - 1
                              : undefined
                    const next = target === undefined ? undefined : entries[target]
                    if (next === undefined) return
                    event.preventDefault()
                    setSelection(next.id)
                    navigation.current?.querySelectorAll('button')[target ?? 0]?.focus()
                  }}
                >
                  <span className="min-w-0 truncate">{entry.id}</span>
                  <StateStatus entry={entry} />
                </Button>
              ))}
            </nav>
          )}
        </aside>
        {selected === undefined ? null : (
          <StateDetail key={`${snapshot.generation}:${selected.id}`} entry={selected} />
        )}
      </div>
    </div>
  )
}

function StateStatus({ entry }: { readonly entry: UserContextInspectionEntry }): ReactNode {
  const status = STATUS[entry.status]
  return (
    <Badge variant={status.variant} appearance="outline">
      {status.label}
    </Badge>
  )
}

function StateDetail({ entry }: { readonly entry: UserContextInspectionEntry }): ReactNode {
  return (
    <Panel variant="flat" size="sm" className="min-w-0">
      <PanelHeader>
        <div className="min-w-0 flex-1">
          <PanelTitle title={entry.id}>{entry.id}</PanelTitle>
          <PanelDescription>Record revision {entry.revision}</PanelDescription>
        </div>
        <PanelActions>
          <StateStatus entry={entry} />
        </PanelActions>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3 overflow-hidden">
        {entry.error === undefined ? null : (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>User Context failed</AlertTitle>
            <AlertDescription className="break-words">{entry.error}</AlertDescription>
          </Alert>
        )}
        <Tabs defaultValue="value" className="min-h-0 flex-1">
          {/* The line indicator extends below the list; reserve its space inside the scrollport. */}
          <div className="min-w-0 shrink-0 overflow-x-auto overflow-y-hidden pb-1.5">
            <TabsList variant="line" aria-label={`Inspect ${entry.id} data`} className="w-max">
              <TabsTrigger value="value">Value</TabsTrigger>
              <TabsTrigger value="keys">Keys</TabsTrigger>
              <TabsTrigger value="schema">Schema</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="value" className="min-h-0 overflow-auto">
            <JsonValue
              value={entry.value}
              label={`value of ${entry.id}`}
              description="The stored record as the server returned it. Each consumer reads it through its own schema, which fills in defaults."
            />
          </TabsContent>
          <TabsContent value="keys" className="min-h-0 overflow-auto">
            <OwnerKeys entry={entry} />
          </TabsContent>
          <TabsContent value="schema" className="min-h-0 overflow-auto">
            {entry.schema === undefined ? (
              <StateEmpty
                title="No owner schema on this page"
                description="Only definitions that read this owner are loaded. Open the owner to see the schema it validates with."
              />
            ) : (
              <JsonValue
                value={entry.schema}
                label={`schema for ${entry.id}`}
                description="The owner's Zod schema as JSON Schema. It validates the owner's writes and every record it loads."
              />
            )}
          </TabsContent>
        </Tabs>
      </PanelContent>
    </Panel>
  )
}

/** The owner schema's fields when this page knows it, and any stored keys besides. */
function localKeys(entry: UserContextInspectionEntry): readonly string[] {
  const keys = new Set(Object.keys(objectOf(objectOf(entry.schema)?.['properties']) ?? {}))
  for (const key of Object.keys(objectOf(entry.value) ?? {})) keys.add(key)
  return [...keys].sort()
}

function objectOf(value: Json | undefined): Readonly<Record<string, Json>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function OwnerKeys({ entry }: { readonly entry: UserContextInspectionEntry }): ReactNode {
  const keys = localKeys(entry)
  const record = objectOf(entry.value)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Addresses use owner:localKey. Only {entry.id} can write these values; other apps and widgets
        read their declared fields. This inspector is read only.
      </p>
      {keys.length === 0 ? (
        <StateEmpty title="No local keys" description="This owner declares no context fields." />
      ) : (
        <Accordion multiple>
          {keys.map(key => {
            const address = `${entry.id}:${key}`
            return (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger>
                  <span className="min-w-0 break-all">{address}</span>
                </AccordionTrigger>
                <AccordionContent>
                  {record !== undefined && !Object.hasOwn(record, key) ? (
                    <StateEmpty
                      title="Value is not stored"
                      description="The owner has not written this key; its schema supplies the default."
                    />
                  ) : (
                    <JsonValue
                      value={record?.[key]}
                      label={`value of ${address}`}
                      description="Stored value, including nested fields."
                    />
                  )}
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </div>
  )
}

/** Cap displayed text so a large document cannot dominate the inspector; copying preserves it. */
function JsonValue({
  value,
  label,
  description,
}: {
  readonly value: unknown
  readonly label: string
  readonly description: string
}): ReactNode {
  const json = useMemo(
    () => (value === undefined ? undefined : JSON.stringify(value, null, 2)),
    [value],
  )
  if (json === undefined)
    return (
      <StateEmpty
        title="No stored value"
        description="The owner has not written a value yet, or its record is still loading. Readers see their schema defaults."
      />
    )
  const limit = 20000
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{description}</p>
        <CopyButton value={json} aria-label={`Copy ${label}`} />
      </div>
      <pre
        aria-label={label}
        className="max-h-96 overflow-auto rounded-md border border-border-subtle bg-muted/30 p-3 font-mono text-xs leading-5"
      >
        <code>{json.slice(0, limit)}</code>
      </pre>
      {json.length > limit ? (
        <p className="text-xs text-muted-foreground">
          Preview limited to {limit.toLocaleString()} characters. Copy includes the complete JSON.
        </p>
      ) : null}
    </div>
  )
}

function StateEmpty({
  title,
  description,
}: {
  readonly title: string
  readonly description: string
}): ReactNode {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DatabaseIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
