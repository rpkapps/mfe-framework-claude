import { useMemo, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
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
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@tecton/react/components/item'
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

import type { SharedStateInspectionEntry, SharedStateStatus } from '@company/mfe-core/shared-state'
import { useMfeRuntime } from '@company/mfe-react'

import { useSharedStateInspection } from './use-shared-state-inspection.ts'

const STATUS: Readonly<
  Record<
    SharedStateStatus,
    { readonly label: string; readonly variant: 'secondary' | 'info' | 'success' | 'destructive' }
  >
> = {
  absent: { label: 'Not loaded', variant: 'secondary' },
  hydrating: { label: 'Hydrating', variant: 'info' },
  ready: { label: 'Ready', variant: 'success' },
  invalid: { label: 'Invalid', variant: 'destructive' },
  'persistence-failed': { label: 'Write failed', variant: 'destructive' },
}

export function SharedStateTab(): ReactNode {
  const { sharedState } = useMfeRuntime('the developer tools shared-state view')
  const snapshot = useSharedStateInspection(sharedState?.inspection)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<string>()
  const entries = useMemo(() => {
    const term = query.trim().toLowerCase()
    return snapshot.entries
      .filter(entry => entry.contract.id.toLowerCase().includes(term))
      .sort((a, b) => a.contract.id.localeCompare(b.contract.id))
  }, [snapshot.entries, query])
  const selected = entries.find(entry => entry.contract.id === selection) ?? entries[0]

  if (!sharedState)
    return (
      <StateEmpty
        title="Shared State is not configured"
        description="Configure sharedState on the shell runtime to inspect its contracts and values."
      />
    )
  if (!sharedState.inspection)
    return (
      <StateEmpty
        title="Inspection is unavailable"
        description="This shared-state service does not expose read-only diagnostics. Use SharedStateRuntime or provide its optional inspection capability."
      />
    )
  if (snapshot.disposed)
    return (
      <StateEmpty
        title="Shared State runtime was disposed"
        description="Reload the shell to inspect the active runtime."
      />
    )
  if (snapshot.entries.length === 0)
    return (
      <StateEmpty
        title="No shared-state contracts"
        description="Add contracts to the shell's shared-state schema to make them available here."
      />
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="success" appearance="outline">
            Live
          </Badge>
          <span className="text-xs text-muted-foreground">
            {snapshot.entries.length} contracts · Read only
          </span>
        </div>
        <InputGroup className="w-full @md:w-64">
          <InputGroupInput
            aria-label="Search shared-state contracts"
            placeholder="Search contracts…"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <InputGroupAddon align="inline-start">
            <SearchIcon data-icon="inline-start" />
          </InputGroupAddon>
        </InputGroup>
      </div>
      {selected === undefined ? (
        <StateEmpty
          title="No contracts match your search"
          description="Search by state ID or clear the search to see all contracts."
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 @3xl:grid-cols-[minmax(14rem,0.8fr)_minmax(0,2fr)]">
          <div className="min-h-0 overflow-y-auto">
            <ItemGroup aria-label="Shared-state contracts" className="gap-1">
              {entries.map(entry => (
                <Item
                  key={entry.contract.id}
                  variant={entry === selected ? 'muted' : 'outline'}
                  size="xs"
                >
                  <ItemContent>
                    <ItemTitle className="w-full">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-w-0 flex-1 justify-start"
                        aria-pressed={entry === selected}
                        aria-label={`Inspect ${entry.contract.id}`}
                        onClick={() => setSelection(entry.contract.id)}
                      >
                        <DatabaseIcon data-icon="inline-start" />
                        <span className="truncate" title={entry.contract.id}>
                          {entry.contract.id}
                        </span>
                      </Button>
                      <StateStatus entry={entry} />
                    </ItemTitle>
                    <ItemDescription>
                      Record revision {entry.recordRevision}
                      {entry.pendingWrites > 0 ? ` · ${entry.pendingWrites} pending` : ''}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </div>
          <StateDetail key={`${snapshot.generation}:${selected.contract.id}`} entry={selected} />
        </div>
      )}
    </div>
  )
}

function StateStatus({ entry }: { readonly entry: SharedStateInspectionEntry }): ReactNode {
  const status = STATUS[entry.status]
  return (
    <Badge
      variant={entry.pendingWrites > 0 && entry.status === 'ready' ? 'warning' : status.variant}
      appearance="outline"
    >
      {entry.pendingWrites > 0 && entry.status === 'ready' ? 'Pending' : status.label}
    </Badge>
  )
}

function StateDetail({ entry }: { readonly entry: SharedStateInspectionEntry }): ReactNode {
  return (
    <Panel variant="outline" size="sm" className="min-h-64">
      <PanelHeader>
        <div className="min-w-0 flex-1">
          <PanelTitle className="break-all">{entry.contract.id}</PanelTitle>
          <PanelDescription>
            Record revision {entry.recordRevision} · {entry.pendingWrites} pending writes
          </PanelDescription>
        </div>
        <PanelActions>
          <StateStatus entry={entry} />
        </PanelActions>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3">
        {entry.error === undefined ? null : (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Shared State failed</AlertTitle>
            <AlertDescription className="break-words">{entry.error}</AlertDescription>
          </Alert>
        )}
        <Tabs defaultValue="effective" className="min-h-0 flex-1">
          <TabsList
            variant="line"
            aria-label={`Inspect ${entry.contract.id} data`}
            className="w-fit max-w-full overflow-x-auto"
          >
            <TabsTrigger value="effective">Current value</TabsTrigger>
            <TabsTrigger value="confirmed">Confirmed</TabsTrigger>
            <TabsTrigger value="contract">Contract</TabsTrigger>
          </TabsList>
          <TabsContent value="effective">
            <JsonValue
              value={entry.effective}
              label={`current value of ${entry.contract.id}`}
              description={
                entry.pendingWrites > 0
                  ? 'Includes optimistic updates awaiting persistence.'
                  : 'The value visible to consumers of the current contract.'
              }
            />
          </TabsContent>
          <TabsContent value="confirmed">
            <JsonValue
              value={entry.confirmed}
              label={`confirmed value of ${entry.contract.id}`}
              description="Last authoritative value accepted by the runtime; revision 0 uses the contract default."
            />
          </TabsContent>
          <TabsContent value="contract">
            <JsonValue
              value={entry.contract}
              label={`contract for ${entry.contract.id}`}
              description="Canonical schema and contract fingerprint. This fingerprint is independent of the record revision."
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
      <StateEmpty
        title="Value has not been loaded"
        description="Open a micro-frontend that consumes this contract. Inspecting it does not trigger hydration."
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
