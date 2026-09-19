/**
 * What the shell believes about the registry, in one place.
 *
 * The registry is the shell's whole model of the page: which surfaces exist,
 * where they load from, what they take. When something is missing from the app
 * finder or a Widget is absent from the catalogue, the answer is always here —
 * either the entry was never registered, or it was rejected and the rejection
 * says exactly why.
 *
 * Quarantine is the reason this view exists. A registry is assembled from
 * descriptors produced by builds the shell does not control, so one of them
 * being wrong is a normal Tuesday, not an exceptional event. The framework
 * validates every entry independently and rejects the bad ones individually, so
 * a container built against the wrong contract major costs the page that one
 * surface. That guarantee is only worth anything if a developer can find out
 * which entry was rejected and what to do about it, which is what the rejected
 * tab is for — the diagnostics below are the framework's own error records,
 * not a message this file wrote.
 */

import { useMemo, type ReactNode } from 'react'
import { useMfeRuntime, type NeutralRegistryEntry } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { ScrollArea } from '@tecton/react/components/scroll-area'
import { Separator } from '@tecton/react/components/separator'
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from '@tecton/react/components/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { AppWindowIcon, BoxIcon, CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'

import { DataList, DataRow, Mono, ValueView } from './readout.tsx'
import { shellUi } from './ui-store.ts'
import { notices } from './workspace.ts'

export interface RegistrySheetProps {
  readonly isOpen: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function RegistrySheet({ isOpen, onOpenChange }: RegistrySheetProps): ReactNode {
  const { entries, quarantined } = useMfeRuntime('the shell registry view').registry
  const accepted = useMemo(() => [...entries.values()], [entries])

  return (
    <Sheet isOpen={isOpen} onOpenChange={onOpenChange} side="right" className="w-full sm:max-w-xl">
      <SheetHeader>
        <SheetTitle>Registry</SheetTitle>
        <SheetDescription>
          Assembled at boot from each container’s generated descriptor. Every entry is validated on
          its own, so a bad one loses only itself.
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <Tabs defaultSelectedKey={quarantined.length > 0 ? 'rejected' : 'loaded'} className="gap-3">
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
            <ScrollArea>
              <ul className="flex max-h-svh flex-col gap-2 overflow-y-auto pr-3">
                {accepted.map(entry => (
                  <AcceptedEntry key={entry.id} entry={entry} />
                ))}
              </ul>
            </ScrollArea>
          </TabsContent>

          <TabsContent id="rejected">
            {notices.registryError === null ? null : (
              <p className="mb-2 rounded-md border border-destructive/40 p-2 text-xs text-destructive">
                registry.json: {notices.registryError.message}
              </p>
            )}
            {quarantined.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every entry in the registry validated. Nothing was rejected.
              </p>
            ) : (
              <ScrollArea>
                <ul className="flex max-h-svh flex-col gap-2 overflow-y-auto pr-3">
                  {quarantined.map((entry, index) => (
                    <li
                      key={`${entry.id}-${String(index)}`}
                      className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive-surface/30 p-3"
                    >
                      {/*
                       * The id gets the row to itself. Sharing it with the
                       * reason — which is a sentence — truncated the one thing
                       * you are looking for down to "leg…".
                       */}
                      <div className="flex items-center gap-2">
                        <TriangleAlertIcon
                          aria-hidden
                          className="size-4 shrink-0 text-destructive"
                        />
                        <span className="min-w-0 truncate font-mono text-sm font-medium">
                          {entry.id}
                        </span>
                      </div>
                      <Badge variant="destructive" className="max-w-full whitespace-normal">
                        {entry.reason}
                      </Badge>

                      {/*
                       * The framework's own diagnostic: what was expected, what
                       * arrived, which rule declared it and the repair. Printed
                       * whole rather than summarised, because the repair line is
                       * the part that is actually actionable. It is prose, so it
                       * is set as prose — a monospace block made a paragraph
                       * look like a stack trace nobody reads.
                       */}
                      <p className="rounded-md bg-background/60 p-2 text-sm whitespace-pre-wrap text-foreground">
                        {entry.error.message}
                      </p>

                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          The descriptor as published
                        </summary>
                        <div className="mt-1.5">
                          <Descriptor source={entry.source} />
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Sheet>
  )
}

/**
 * What the container published, as fields.
 *
 * This is the one place in the shell where showing raw JSON is defensible —
 * it is literally the document that failed — and it is still the wrong
 * presentation: a rejected descriptor is read to find the one field that is
 * wrong, and `JSON.stringify(…, null, 2)` buries it in punctuation. Rows,
 * with the value rendered for what it is.
 */
function Descriptor({ source }: { readonly source: unknown }): ReactNode {
  if (source === null || typeof source !== 'object' || Array.isArray(source))
    return (
      <div className="rounded-md border border-border-subtle bg-background/60 p-2">
        <ValueView value={source} />
      </div>
    )

  return (
    <DataList className="bg-background/60">
      {Object.entries(source as Record<string, unknown>).map(([name, value]) => (
        <DataRow key={name} label={<Mono>{name}</Mono>}>
          <ValueView value={value} />
        </DataRow>
      ))}
    </DataList>
  )
}

function AcceptedEntry({ entry }: { readonly entry: NeutralRegistryEntry }): ReactNode {
  const isApp = entry.definitionKind === 'app'

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card p-3">
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

/**
 * The strip under the header. It reports two things a developer has to be able
 * to see without looking for them — an active override, which is the phantom
 * bug the override mechanism exists to prevent, and a rejected entry — and it
 * renders nothing when there is neither.
 *
 * It is a line, not an alarm. A rejected entry is a fact about the registry,
 * and the shell around it is working; shouting about it on every page teaches
 * the developer to stop reading the strip, which is the one place the override
 * warning also lives.
 */
export function RegistryNotice(): ReactNode {
  const { quarantined } = useMfeRuntime('the shell notices').registry
  const { overrides, registryError } = notices
  if (overrides.size === 0 && quarantined.length === 0 && registryError === null) return null

  const rejected = quarantined.length + (registryError === null ? 0 : 1)

  /*
   * Everything here wraps. A strip that is one non-breaking row is fine at
   * 1440px and truncates its own link off the right edge of a phone — which
   * takes the only route to the explanation with it.
   */
  return (
    <div className="flex shrink-0 flex-col gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-1.5 text-xs sm:flex-row sm:flex-wrap sm:items-center">
      {overrides.size > 0 ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-warning-surface-foreground">
          <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="font-medium">
            {overrides.size === 1
              ? 'A developer override is'
              : `${String(overrides.size)} developer overrides are`}{' '}
            active:
          </span>
          {[...overrides].map(([id, url]) => (
            <Badge key={id} variant="warning" appearance="outline" size="default">
              {id} → {url}
            </Badge>
          ))}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onPress={() => {
              shellUi.show('settings')
            }}
          >
            Manage
          </Button>
        </span>
      ) : null}

      {rejected > 0 ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 text-muted-foreground">
            {rejected} registry {rejected === 1 ? 'entry was' : 'entries were'} rejected — the rest
            of the page is unaffected.
          </span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onPress={() => {
              shellUi.show('registry')
            }}
          >
            See why
          </Button>
        </span>
      ) : null}
    </div>
  )
}
