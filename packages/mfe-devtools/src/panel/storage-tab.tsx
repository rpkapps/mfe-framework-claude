import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
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
import { Separator } from '@tecton/react/components/separator'
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
import { DatabaseIcon, RotateCwIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react'

import type { UserLoadPhase, UserStorageStore } from '@company/mfe-runtime'
import { useMfeRuntime } from '@company/mfe-react'

import {
  entryStatus,
  useUserStorageInspection,
  type UserStorageEntry,
  type UserStorageEntryStatus,
} from './use-user-storage-inspection.ts'

type Variant = 'secondary' | 'info' | 'success' | 'warning' | 'destructive'

const STATUS: Readonly<
  Record<UserStorageEntryStatus, { readonly label: string; readonly variant: Variant }>
> = {
  loading: { label: 'Loading', variant: 'info' },
  ready: { label: 'Ready', variant: 'success' },
  saving: { label: 'Saving', variant: 'warning' },
  error: { label: 'Error', variant: 'destructive' },
}

const PHASE: Readonly<
  Record<UserLoadPhase, { readonly label: string; readonly variant: Variant }>
> = {
  loading: { label: 'Loading', variant: 'info' },
  ready: { label: 'Loaded', variant: 'success' },
  error: { label: 'Load failed', variant: 'destructive' },
}

/** Entries arrive sorted by owner, so each owner's keys are one run. */
function groupByOwner<T extends { readonly owner: string }>(
  entries: readonly T[],
): readonly { readonly owner: string; readonly entries: readonly T[] }[] {
  const groups: { owner: string; entries: T[] }[] = []
  for (const entry of entries) {
    const last = groups.at(-1)
    if (last?.owner === entry.owner) last.entries.push(entry)
    else groups.push({ owner: entry.owner, entries: [entry] })
  }
  return groups
}

/** One label per row; owners are package names and keys are dotted or colon-separated, never `›`. */
function entryId(entry: UserStorageEntry): string {
  return `${entry.owner} › ${entry.key}`
}

export function StorageTab(): ReactNode {
  const { storage } = useMfeRuntime('the developer tools storage view')
  const store = storage.user
  const snapshot = useUserStorageInspection(store)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<string>()
  const navigation = useRef<HTMLElement>(null)
  const allEntries = snapshot.entries
  const entries = useMemo(() => {
    const term = query.trim().toLowerCase()
    return allEntries.filter(entry => entryId(entry).toLowerCase().includes(term))
  }, [allEntries, query])
  const ids = useMemo(() => allEntries.map(entryId), [allEntries])
  const selected = allEntries.find(entry => entryId(entry) === selection) ?? allEntries[0]
  const tabStop = entries.find(entry => entry === selected) ?? entries[0]

  if (store === undefined)
    return (
      <StorageEmpty
        title="User storage is not configured"
        description="The shell has no user storage adapter. Pass storage: { user } to createMfeRuntime to inspect the user area here."
      />
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Badge variant={PHASE[snapshot.phase].variant} appearance="outline">
          {PHASE[snapshot.phase].label}
        </Badge>
        <span className="text-xs text-muted-foreground">
          User area · {allEntries.length} keys · Read only
        </span>
      </div>
      {snapshot.phase === 'error' ? (
        <div className="shrink-0 border-b border-border p-2">
          <LoadFailed store={store} message={snapshot.loadError?.message} />
        </div>
      ) : null}
      {allEntries.length === 0 ? (
        snapshot.phase === 'loading' ? (
          <StorageEmpty
            title="Loading user storage"
            description="The shell's user storage adapter has not answered yet."
          />
        ) : (
          <StorageEmpty
            title="No stored values"
            description="Nothing is stored in the user area yet. Values appear here once an app or the shell sets a storage: 'user' key."
          />
        )
      ) : (
        <>
          {selected === undefined ? null : (
            <div className="shrink-0 border-b border-border p-2 @3xl:hidden">
              <Combobox
                items={ids}
                value={entryId(selected)}
                onValueChange={value => {
                  if (value !== null) setSelection(value)
                }}
              >
                <ComboboxTrigger
                  render={<Button variant="outline" className="w-full min-w-0 justify-between" />}
                  aria-label="Choose stored key"
                >
                  <span className="min-w-0 truncate">
                    <ComboboxValue />
                  </span>
                </ComboboxTrigger>
                <ComboboxContent className="min-w-0">
                  <ComboboxInput
                    aria-label="Find a stored key"
                    placeholder="Search keys…"
                    showTrigger={false}
                  />
                  <ComboboxEmpty>No keys match your search.</ComboboxEmpty>
                  <ComboboxList>
                    {(id: string) => (
                      <ComboboxItem key={id} value={id}>
                        <span className="min-w-0 truncate" title={id}>
                          {id}
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
                    aria-label="Search stored keys"
                    placeholder="Filter keys…"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                  />
                  <InputGroupAddon align="inline-start">
                    <SearchIcon data-icon="inline-start" />
                  </InputGroupAddon>
                </InputGroup>
              </div>
              {entries.length === 0 ? (
                <StorageEmpty
                  title="No keys match your search"
                  description="Search by owner or key, or clear the search to see every stored value."
                />
              ) : (
                <nav
                  ref={navigation}
                  aria-label="Stored keys"
                  className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1"
                >
                  {groupByOwner(entries).map(group => (
                    <div
                      key={group.owner}
                      role="group"
                      aria-label={`Owned by ${group.owner}`}
                      className="flex flex-col gap-0.5 pb-2"
                    >
                      {/* A section heading, not a row: it names the app that owns the keys below. */}
                      <div className="flex items-center gap-2 px-2 pt-2 pb-1" aria-hidden="true">
                        <span
                          className="min-w-0 truncate text-[length:--spacing(2.75)] font-medium tracking-wider text-muted-foreground uppercase"
                          title={group.owner}
                        >
                          {group.owner}
                        </span>
                        <Separator emphasis="subtle" className="flex-1" />
                        <span className="text-[length:--spacing(2.75)] text-muted-foreground tabular-nums">
                          {group.entries.length}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5 pl-2">
                        {group.entries.map(entry => {
                          const index = entries.indexOf(entry)
                          return (
                            <Button
                              key={entryId(entry)}
                              variant={entry === selected ? 'secondary' : 'ghost'}
                              size="sm"
                              className="w-full min-w-0 justify-between"
                              aria-pressed={entry === selected}
                              aria-label={`Inspect ${entryId(entry)}`}
                              title={entryId(entry)}
                              tabIndex={entry === tabStop ? 0 : -1}
                              onClick={() => setSelection(entryId(entry))}
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
                                setSelection(entryId(next))
                                navigation.current?.querySelectorAll('button')[target ?? 0]?.focus()
                              }}
                            >
                              <span className="min-w-0 truncate">{entry.key}</span>
                              <StorageStatus entry={entry} />
                            </Button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </nav>
              )}
            </aside>
            {selected === undefined ? null : (
              <StorageDetail key={entryId(selected)} entry={selected} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function LoadFailed({
  store,
  message,
}: {
  readonly store: UserStorageStore
  readonly message: string | undefined
}): ReactNode {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>User storage failed to load</AlertTitle>
      <AlertDescription className="break-words">
        {message ?? 'The adapter’s load() failed.'} Apps mounted with defaults.
      </AlertDescription>
      <AlertAction>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void store.retryLoad()
          }}
        >
          <RotateCwIcon data-icon="inline-start" />
          Retry
        </Button>
      </AlertAction>
    </Alert>
  )
}

function StorageStatus({ entry }: { readonly entry: UserStorageEntry }): ReactNode {
  const status = STATUS[entryStatus(entry.state)]
  return (
    <Badge variant={status.variant} appearance="outline">
      {status.label}
    </Badge>
  )
}

function StorageDetail({ entry }: { readonly entry: UserStorageEntry }): ReactNode {
  const { row, pending, error } = entry.state
  const id = entryId(entry)
  return (
    <Panel variant="flat" size="sm" className="min-w-0">
      <PanelHeader>
        <div className="min-w-0 flex-1">
          <PanelTitle title={entry.key}>{entry.key}</PanelTitle>
          <PanelDescription>
            {row === undefined
              ? `Owner ${entry.owner} · Not stored yet`
              : `Owner ${entry.owner} · Revision ${row.revision} · Schema version ${row.v}`}
          </PanelDescription>
        </div>
        <PanelActions>
          <StorageStatus entry={entry} />
        </PanelActions>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3 overflow-hidden">
        {error === undefined ? null : (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>{entry.state.phase === 'error' ? 'Load failed' : 'Save failed'}</AlertTitle>
            <AlertDescription className="break-words">{error.message}</AlertDescription>
          </Alert>
        )}
        <Tabs defaultValue="stored" className="min-h-0 flex-1">
          {/* The line indicator extends below the list; reserve its space inside the scrollport. */}
          <div className="min-w-0 shrink-0 overflow-x-auto overflow-y-hidden pb-1.5">
            <TabsList variant="line" aria-label={`Inspect ${id} data`} className="w-max">
              <TabsTrigger value="stored">Stored data</TabsTrigger>
              <TabsTrigger value="row">Row</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="stored" className="flex min-h-0 flex-col gap-3 overflow-auto">
            {pending === undefined ? null : (
              <JsonValue
                value={pending === null ? null : pending.d}
                label={`value being saved for ${id}`}
                description={
                  pending === null
                    ? 'A removal is being sent; null stands in for it.'
                    : `Being saved with schema version ${pending.v}; readers see it until the save settles.`
                }
              />
            )}
            <JsonValue
              value={row?.d}
              label={`stored data of ${id}`}
              description="The data the server confirmed, before it is decoded against a key's schema."
            />
          </TabsContent>
          <TabsContent value="row" className="min-h-0 overflow-auto">
            <JsonValue
              value={row}
              label={`row of ${id}`}
              description="The stored row as the adapter returned it: schema version v, data d and revision."
            />
          </TabsContent>
        </Tabs>
      </PanelContent>
    </Panel>
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
      <StorageEmpty
        title="Nothing is stored"
        description="This key has no confirmed row; it is shown while a save or its error is outstanding."
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

function StorageEmpty({
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
