/**
 * The App boundary.
 *
 * `/$appId` and `/$appId/$` are the shell's outermost routes. Everything from
 * the boundary downwards — path, search, layout, its own router — belongs to
 * the mounted App, so this component renders `AppHost` and nothing else. No
 * padding, no card, no page header: the App decides.
 *
 * The fallback is the one piece of chrome the shell keeps here, because a
 * remote that will not load has to fail visibly and recoverably rather than
 * blanking the page.
 */

import { Suspense, type ReactNode } from 'react'
import { AppHost, type AppFallbackProps } from '@company/mfe-react'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { Spinner } from '@tecton/react/components/spinner'
import { PlugZapIcon, RotateCcwIcon, SearchXIcon } from 'lucide-react'

import { useAppEntries } from './registry-view.ts'

export function AppBoundary({ appId }: { readonly appId: string }): ReactNode {
  const apps = useAppEntries()
  const known = apps.some(app => app.id === appId)

  if (!known) return <UnknownApp appId={appId} knownIds={apps.map(app => app.id)} />

  return (
    <Suspense fallback={<AppLoading appId={appId} />}>
      <AppHost
        appId={appId}
        basePath={`/${appId}`}
        fallback={props => <AppFailure appId={appId} {...props} />}
      />
    </Suspense>
  )
}

function AppLoading({ appId }: { readonly appId: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyTitle>Loading {appId}</EmptyTitle>
        <EmptyDescription>Fetching the container manifest and its entry.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/**
 * The real error surface: the framework error's own message (which states what
 * was expected, what happened and how to repair it) and a Retry that re-runs
 * the load rather than reloading the page.
 */
function AppFailure({
  appId,
  error,
  retry,
}: AppFallbackProps & { readonly appId: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="text-destructive">
          <PlugZapIcon />
        </EmptyMedia>
        <EmptyTitle>{appId} could not be loaded</EmptyTitle>
        <EmptyDescription className="max-w-prose">{error.message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-col items-center gap-3">
          <Button variant="outline" onPress={retry}>
            <RotateCcwIcon /> Retry
          </Button>
          <code className="rounded-sm bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {error.code} · {error.id}
          </code>
        </div>
      </EmptyContent>
    </Empty>
  )
}

function UnknownApp({
  appId,
  knownIds,
}: {
  readonly appId: string
  readonly knownIds: readonly string[]
}) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>No application is registered as “{appId}”</EmptyTitle>
        <EmptyDescription>
          {knownIds.length === 0
            ? 'The registry is empty, or every entry was quarantined. Open shell diagnostics for the reasons.'
            : `Registered ids: ${knownIds.join(', ')}.`}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
