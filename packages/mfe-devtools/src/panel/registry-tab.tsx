/**
 * What the runtime believes about the registry. Rejection is why the view exists: the framework
 * rejects bad entries one at a time, and that only helps if a developer can find out which entry
 * was rejected and why.
 */

import { Fragment, type ReactNode } from 'react'
import { useMfeRuntime, type RegistryEntry } from '@company/mfe-react'
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

import { EntryView } from './entry-view.tsx'
import { factsOf } from './entry-facts.ts'
import { OriginText } from './origin-text.tsx'
import { useRegistryEntries } from './use-devtools.ts'

/**
 * The overrides list's grid at a wider track, because these rows carry a contract under them.
 * `auto-rows-fr` is what makes every card match the tallest, without a height that would clip one.
 */
const ENTRY_GRID = 'grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))]'

/** A block of prose keeps a readable measure however wide the dock is opened. */
const PROSE = 'max-w-3xl'

export function RegistryTab(): ReactNode {
  const { rejected } = useMfeRuntime('the developer tools registry view').registry
  const accepted = useRegistryEntries()

  return (
    <Tabs
      defaultSelectedKey={rejected.length > 0 ? 'rejected' : 'loaded'}
      className="flex min-h-0 flex-col gap-2.5"
    >
      {/* An underline bar, so these read as a filter rather than a second copy of the panel's own tabs. */}
      <TabsList variant="line" aria-label="Registry entries" className="h-8 w-fit">
        <TabsTrigger id="loaded">
          <CircleCheckIcon /> Loaded
          <Badge variant="secondary" size="default">
            {accepted.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger id="rejected">
          <TriangleAlertIcon /> Rejected
          <Badge variant={rejected.length > 0 ? 'destructive' : 'secondary'} size="default">
            {rejected.length}
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
        {rejected.length === 0 ? (
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
            {rejected.map((entry, index) => (
              <Alert
                key={`${entry.id}-${String(index)}`}
                variant="destructive"
                appearance="outline"
              >
                <TriangleAlertIcon />
                <AlertTitle className="font-mono">{entry.id}</AlertTitle>
                <AlertDescription className="flex flex-col gap-1.5">
                  {/* The framework's own diagnostic, printed whole because the repair line is the actionable part. */}
                  <p className="whitespace-pre-wrap">{entry.error.message}</p>
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-muted-foreground">
                      The entry as published
                    </summary>
                    {/* Neutral text inside a destructive alert: red on every field hides the one that is wrong. */}
                    <div className="mt-1.5 rounded-md bg-background/60 p-2 text-foreground">
                      <EntryView source={entry.source} />
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
 * Only `overridden` is a badge: with the version, the capabilities, the inputs and the outputs all
 * badges too, the one row that had been re-pointed looked exactly like the seven that had not.
 */
function AcceptedEntry({ entry }: { readonly entry: RegistryEntry }): ReactNode {
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

          {/* Hard right, where the overrides tab puts it, so the ports line up down the column. */}
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
