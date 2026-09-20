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
 *
 * A loaded entry is drawn as the same row as the overrides tab draws it: the id
 * in mono on the left, the origin on the right, the rest underneath. The two
 * tabs are two views of one list, and printing the id and the URL two different
 * ways was most of what made the second one feel like a different tool.
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
  ItemTitle,
} from '@tecton/react/components/item'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { AppWindowIcon, BoxIcon, CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'

import { DescriptorView } from './descriptor-view.tsx'
import { factsOf } from './entry-facts.ts'
import { OriginText } from './origin-text.tsx'
import { useRegistryEntries } from './use-devtools.ts'

/**
 * Columns rather than rows stretched to the panel — the same grid the overrides
 * list uses, at a wider track because these rows carry a contract under them.
 * See the note beside `ROW_GRID` there for why a docked panel has to do this.
 *
 * `auto-rows-fr` is what makes every card the same height. In a grid whose own
 * height is auto there is no free space to divide, so each `1fr` row resolves
 * to the tallest row's content and every card matches it — an entry with no
 * contract lines up with one that has two, without a hard-coded height that
 * would clip whichever entry turned out to have three.
 */
const ENTRY_GRID = 'grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))]'

/** A block of prose keeps a readable measure however wide the dock is opened. */
const PROSE = 'max-w-3xl'

export function RegistryTab(): ReactNode {
  const { quarantined } = useMfeRuntime('the developer tools registry view').registry
  const accepted = useRegistryEntries()

  return (
    <Tabs
      defaultSelectedKey={quarantined.length > 0 ? 'rejected' : 'loaded'}
      className="flex min-h-0 flex-col gap-2.5"
    >
      {/*
       * An underline bar, not another segmented one. The panel's own tabs are
       * segmented and live up in the header now, so these read as a filter
       * inside the view rather than as a second copy of the same control.
       */}
      <TabsList variant="line" aria-label="Registry entries" className="h-8 w-fit">
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
          <Empty className={PROSE}>
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
          <ItemGroup className={ENTRY_GRID}>
            {accepted.map(entry => (
              <AcceptedEntry key={entry.id} entry={entry} />
            ))}
          </ItemGroup>
        )}
      </TabsContent>

      <TabsContent id="rejected">
        {quarantined.length === 0 ? (
          <Empty className={PROSE}>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheckIcon />
              </EmptyMedia>
              <EmptyTitle>Every entry validated</EmptyTitle>
              <EmptyDescription>Nothing was rejected.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className={`flex flex-col gap-2 ${PROSE}`}>
            {quarantined.map((entry, index) => (
              <Alert
                key={`${entry.id}-${String(index)}`}
                variant="destructive"
                appearance="outline"
              >
                <TriangleAlertIcon />
                <AlertTitle className="font-mono">{entry.id}</AlertTitle>
                <AlertDescription className="flex flex-col gap-1.5">
                  {/*
                   * The framework's own diagnostic: what was expected, what
                   * arrived and the repair. Printed whole rather than
                   * summarised, because the repair line is the actionable part.
                   */}
                  <p className="whitespace-pre-wrap">{entry.error.message}</p>
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-muted-foreground">
                      The descriptor as published
                    </summary>
                    {/*
                     * Neutral text, inside a destructive alert. The descriptor
                     * is data, and rendering every field in the alert's red
                     * makes the one field that is actually wrong no easier to
                     * find than the six that are fine.
                     */}
                    <div className="mt-1.5 rounded-md bg-background/60 p-2 text-foreground">
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

/**
 * One accepted entry: identity on the first line, the human title on the
 * second, and the contract underneath as labelled pairs.
 *
 * Only `overridden` is a badge. A badge is a claim that something is unusual,
 * and when the version, every capability, every input and every event were all
 * badges too, the one row that had actually been re-pointed at a dev server
 * looked exactly like the seven that had not.
 */
function AcceptedEntry({ entry }: { readonly entry: NeutralRegistryEntry }): ReactNode {
  const Icon = entry.definitionKind === 'app' ? AppWindowIcon : BoxIcon
  const overridden = entry.overridden === true
  const facts = factsOf(entry)

  return (
    <Item variant="muted" size="xs" className="group items-start py-1.5">
      <ItemMedia variant="icon" className={overridden ? 'text-warning' : 'text-muted-foreground'}>
        <Icon />
      </ItemMedia>

      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="w-full min-w-0 gap-2">
          <span className="truncate font-mono text-xs">{entry.id}</span>

          {entry.version === undefined ? null : (
            <span className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">
              {entry.version}
            </span>
          )}

          {overridden ? (
            <Badge variant="warning" appearance="outline" size="default">
              overridden
            </Badge>
          ) : null}

          {/*
           * The origin sits where the overrides tab puts it — hard right, so
           * the ports line up down the column and a row that points somewhere
           * unexpected is found by scanning rather than by reading.
           */}
          <span
            title={entry.manifestUrl}
            className="ml-auto shrink-0 font-mono text-xs font-normal text-muted-foreground"
          >
            <OriginText url={entry.manifestUrl} />
          </span>
        </ItemTitle>

        {entry.title === undefined ? null : (
          <ItemDescription className="truncate">{entry.title}</ItemDescription>
        )}

        {facts.length === 0 ? null : (
          <dl className="mt-1 grid w-full grid-cols-[minmax(0,3.75rem)_minmax(0,1fr)] gap-x-2 text-[11px] leading-5">
            {facts.map(fact => (
              <Fragment key={fact.label}>
                <dt className="truncate text-muted-foreground">{fact.label}</dt>
                <dd className="min-w-0 font-mono break-words">{fact.values.join('  ')}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </ItemContent>

      <ItemActions className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
        <CopyButton
          size="icon-xs"
          value={entry.manifestUrl}
          aria-label={`Copy the manifest URL for ${entry.id}`}
        />
      </ItemActions>
    </Item>
  )
}
