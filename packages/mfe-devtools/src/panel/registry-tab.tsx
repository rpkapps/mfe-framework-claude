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

import type { ReactNode } from 'react'
import { useMfeRuntime, type NeutralRegistryEntry } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Separator } from '@tecton/react/components/separator'
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
          <p className="text-sm text-muted-foreground">
            Nothing was registered. If that is a surprise, the rejected tab is where it went.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {accepted.map(entry => (
              <AcceptedEntry key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent id="rejected">
        {quarantined.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every entry in the registry validated. Nothing was rejected.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {quarantined.map((entry, index) => (
              <li
                key={`${entry.id}-${String(index)}`}
                className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive-surface/30 p-3"
              >
                {/*
                 * The id gets the row to itself. Sharing it with the reason —
                 * which is a sentence — truncated the one thing you are looking
                 * for down to "leg…".
                 */}
                <div className="flex items-center gap-2">
                  <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
                  <span className="min-w-0 truncate font-mono text-sm font-medium">{entry.id}</span>
                </div>
                <Badge variant="destructive" className="max-w-full whitespace-normal">
                  {entry.reason}
                </Badge>

                {/*
                 * The framework's own diagnostic: what was expected, what
                 * arrived and the repair. Printed whole rather than summarised,
                 * because the repair line is the part that is actionable. It is
                 * prose, so it is set as prose — a monospace block made a
                 * paragraph look like a stack trace nobody reads.
                 */}
                <p className="rounded-md bg-background/60 p-2 text-sm whitespace-pre-wrap text-foreground">
                  {entry.error.message}
                </p>

                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    The descriptor as published
                  </summary>
                  <div className="mt-1.5">
                    <DescriptorView source={entry.source} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  )
}

function AcceptedEntry({ entry }: { readonly entry: NeutralRegistryEntry }): ReactNode {
  const isApp = entry.definitionKind === 'app'

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-background/40 p-3">
      <div className="flex items-center gap-2">
        {isApp ? (
          <AppWindowIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <BoxIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-sm font-medium">{entry.title ?? entry.id}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{entry.id}</span>
        <Badge variant={isApp ? 'info' : 'secondary'} size="default" className="ml-auto shrink-0">
          {entry.definitionKind}
        </Badge>
        {entry.version === undefined ? null : (
          <Badge variant="outline" size="default" className="shrink-0">
            {entry.version}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {entry.manifestUrl}
        </code>
        <CopyButton value={entry.manifestUrl} aria-label="Copy manifest URL" />
      </div>

      {entry.overridden === true ? (
        <p className="text-xs text-warning-surface-foreground">
          A developer override replaced this entry’s manifest URL at boot.
        </p>
      ) : null}

      {entry.capabilities === undefined ? null : (
        <>
          <Separator emphasis="subtle" />
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">capabilities</span>
            {entry.capabilities.map(capability => (
              <Badge key={capability.name} variant="outline" size="default">
                {capability.name} → {capability.path}
              </Badge>
            ))}
          </div>
        </>
      )}

      {entry.contract === undefined ? null : (
        <>
          <Separator emphasis="subtle" />
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">inputs</span>
            {entry.contract.inputs === undefined ? (
              <Badge variant="secondary" size="default">
                not published
              </Badge>
            ) : (
              Object.keys((entry.contract.inputs['properties'] ?? {}) as object).map(name => (
                <Badge key={name} variant="outline" size="default">
                  {name}
                </Badge>
              ))
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">events</span>
            {entry.contract.events.length === 0 ? (
              <span className="text-xs text-muted-foreground">none</span>
            ) : (
              entry.contract.events.map(event => (
                <Badge key={event} variant="info" size="default">
                  {event}
                </Badge>
              ))
            )}
          </div>
        </>
      )}
    </li>
  )
}
