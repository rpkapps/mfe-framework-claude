/**
 * The shell owns the outermost routes and nothing below them. `/$appId` is the
 * boundary; `/$appId/$` is everything the mounted App routes for itself, which
 * is why the dev server needs a history-API fallback.
 */

import { Suspense, type ReactNode } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useParams,
  type AnyRoute,
} from '@tanstack/react-router'
import { AppHost, type MfeError, type MfeRuntime } from '@company/mfe-react'
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
import { PlugZapIcon, RotateCcwIcon } from 'lucide-react'

import { ShellLayout } from './chrome.tsx'

const rootRoute = createRootRoute({
  component: () => (
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  ),
})

function Failure({ error, retry }: { error: MfeError; retry: () => void }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="text-destructive">
          <PlugZapIcon />
        </EmptyMedia>
        <EmptyTitle>{error.id} could not be loaded</EmptyTitle>
        <EmptyDescription className="max-w-prose">{error.message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onPress={retry}>
          <RotateCcwIcon /> Retry
        </Button>
        <code className="font-mono text-xs text-muted-foreground">{error.code}</code>
      </EmptyContent>
    </Empty>
  )
}

function Boundary(): ReactNode {
  // Three routes share this component, so the id comes from the loose params
  // bag, which TanStack types as `any` without a registered router instance.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const appId: string = useParams({ strict: false }).appId ?? ''

  // Everything below the boundary is the App's: no padding, no card, no page
  // header. `fallback` covers an unresolvable id and a mount-time failure
  // alike, and its retry is a genuinely fresh attempt.
  return (
    <Suspense fallback={<Spinner className="m-auto size-6" />}>
      <AppHost
        appId={appId}
        basePath={`/${appId}`}
        fallback={props => <Failure error={props.error} retry={props.retry} />}
      />
    </Suspense>
  )
}

export function createShellRouter(runtime: MfeRuntime) {
  // The shell has no page of its own: `/` opens the first registered App. With
  // an empty or wholly quarantined registry there is nothing to open, and the
  // boundary's own error surface says so.
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      const first = [...runtime.registry.entries.values()].find(
        entry => entry.definitionKind === 'app' && entry.hidden !== true,
      )
      // TanStack signals a redirect by throwing a non-Error marker object.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (first) throw redirect({ href: `/${first.id}`, replace: true })
    },
    component: Boundary,
  })

  const routeTree = rootRoute.addChildren([
    indexRoute,
    createRoute({ getParentRoute: () => rootRoute, path: '/$appId', component: Boundary }),
    createRoute({ getParentRoute: () => rootRoute, path: '/$appId/$', component: Boundary }),
  ] as AnyRoute[])

  return createRouter({ routeTree, defaultPreload: 'intent' })
}
