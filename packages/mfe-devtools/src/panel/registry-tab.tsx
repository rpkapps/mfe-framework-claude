/**
 * What the runtime believes about the registry, in one place.
 *
 * The registry is the whole model of the page: which surfaces exist, where they
 * load from, what they take. When something is missing from an app finder or a
 * Widget is absent from a catalogue, the answer is always here — either the
 * entry was never registered, or it was rejected and the rejection says exactly
 * why.
 *
 * Quarantine is the reason this view exists. A registry is assembled from
 * descriptors produced by builds the host does not control, so one of them
 * being wrong is a normal Tuesday rather than an exceptional event. The
 * framework validates every entry independently and rejects the bad ones one at
 * a time, so a container built against the wrong contract major costs the page
 * that one surface. That guarantee is only worth anything if a developer can
 * find out which entry was rejected and what to do about it, which is what the
 * rejected tab is for — the diagnostics below are the framework's own error
 * records, not a message this file wrote.
 */

import { Fragment, type ReactNode } from 'react'
import { useMfeRuntime, type NeutralRegistryEntry } from '@company/mfe-react'
import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Badge } from '@tecton/react/components/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@tecton/react/components/item'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { AppWindowIcon, BoxIcon, CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'

import { DescriptorView } from './descriptor-view.tsx'
import { useRegistryEntries } from './use-devtools.ts'

export function RegistryTab(): ReactNode {
  const { quarantined } = useMfeRuntime('the developer tools registry view').registry
  const accepted = useRegistryEntries()

  return (
    <Tabs
      defaultSelectedKey={quarantined.length > 0 ? 'rejected' : 'loaded'}
      className="flex min-h-0 flex-col gap-3"
    >
      <TabsList variant="line" aria-label="Registry entries">
        <TabsTrigger id="loaded">
          <CircleCheckIcon /> Loaded
          <Badge variant="secondary" size="default">
            {accepted.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger id="rejected">
          <TriangleAlertIcon /> Rejected
          <Badge variant={quarantined.length > 0 ? 'destructive' : 'secondary'} size="default">
            {quarantined.length}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent id="loaded">
        {accepted.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheckIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing was registered</EmptyTitle>
              <EmptyDescription>
                If that is a surprise, the rejected tab is where it went.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="overflow-hidden rounded-lg border border-border-subtle">
            {accepted.map((entry, index) => (
              <Fragment key={entry.id}>
                {index === 0 ? null : <ItemSeparator className="my-0" />}
                <AcceptedEntry entry={entry} />
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </TabsContent>

      <TabsContent id="rejected">
        {quarantined.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheckIcon />
              </EmptyMedia>
              <EmptyTitle>Every entry validated</EmptyTitle>
              <EmptyDescription>Nothing was rejected.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {quarantined.map((entry, index) => (
              <Alert
                key={`${entry.id}-${String(index)}`}
                variant="destructive"
                appearance="outline"
              >
                <TriangleAlertIcon />
                <AlertTitle className="font-mono">{entry.id}</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  {/*
                   * The framework's own diagnostic: what was expected, what
                   * arrived and the repair. Printed whole rather than
                   * summarised, because the repair line is the actionable part.
                   */}
                  <p className="whitespace-pre-wrap">{entry.error.message}</p>
                  <details className="text-xs">
                    <summary className="cursor-pointer">The descriptor as published</summary>
                    <div className="mt-1.5">
                      <DescriptorView source={entry.source} />
                    </div>
                  </details>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}

/** One accepted entry, as an `Item` rather than a hand-built card. */
function AcceptedEntry({ entry }: { readonly entry: NeutralRegistryEntry }): ReactNode {
  const isApp = entry.definitionKind === 'app'
  const Icon = isApp ? AppWindowIcon : BoxIcon

  return (
    <Item size="sm" className="rounded-none">
      <ItemMedia variant="icon" className="text-muted-foreground">
        <Icon />
      </ItemMedia>

      <ItemContent className="gap-1">
        <ItemTitle className="flex flex-wrap items-center gap-2">
          <span className="truncate">{entry.title ?? entry.id}</span>
          <span className="truncate font-mono text-xs font-normal text-muted-foreground">
            {entry.id}
          </span>
          {entry.version === undefined ? null : (
            <Badge variant="outline" size="default">
              {entry.version}
            </Badge>
          )}
          {entry.overridden === true ? (
            <Badge variant="warning" appearance="outline" size="default">
              overridden
            </Badge>
          ) : null}
        </ItemTitle>

        <ItemDescription className="font-mono">{entry.manifestUrl}</ItemDescription>

        {entry.capabilities === undefined && entry.contract === undefined ? null : (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {entry.capabilities?.map(capability => (
              <Badge key={capability.name} variant="outline" size="default">
                {capability.name} → {capability.path}
              </Badge>
            ))}
            {entry.contract === undefined
              ? null
              : Object.keys((entry.contract.inputs?.['properties'] ?? {}) as object).map(name => (
                  <Badge key={`in-${name}`} variant="secondary" size="default">
                    {name}
                  </Badge>
                ))}
            {entry.contract?.events.map(event => (
              <Badge key={`ev-${event}`} variant="info" size="default">
                {event}
              </Badge>
            ))}
          </div>
        )}
      </ItemContent>

      <ItemActions>
        <CopyButton
          value={entry.manifestUrl}
          aria-label={`Copy the manifest URL for ${entry.id}`}
        />
      </ItemActions>
    </Item>
  )
}
