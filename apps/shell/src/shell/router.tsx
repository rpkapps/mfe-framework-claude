/**
 * The shell owns the outermost routes and nothing below them. `/$appId` is the
 * boundary; `/$appId/$` is everything the mounted App routes for itself, which
 * is why the dev server needs a history-API fallback.
 */

import { Suspense, use, useState, type ReactNode } from 'react'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useParams,
  type AnyRoute,
} from '@tanstack/react-router'
import { AppHost, useMfeRuntime, type MfeRuntime } from '@company/mfe-react'
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

/** What the error surface shows. Every framework error supplies these three. */
interface LoadFailure {
  readonly id: string
  readonly code: string
  readonly message: string
}

const attempts = new Map<string, Promise<LoadFailure | null>>()

/**
 * HAZARD, and the reason the boundary is not simply `<AppHost>`.
 *
 * `@company/mfe-react` drops its cached load promise when a load fails, so the
 * render that should surface the error is handed a *new* pending promise and
 * suspends again. An unreachable remote therefore never reaches `AppHost`'s
 * fallback and instead refetches its manifest as fast as the browser allows
 * (measured: ~340 requests/second). Resolving the load here first, through a
 * cache that keeps the outcome — failure included — is what turns that into one
 * attempt and one error surface. Remove this once the loader keeps its
 * rejection, not before.
 */
function resolveOnce(runtime: MfeRuntime, appId: string): Promise<LoadFailure | null> {
  const cached = attempts.get(appId)
  if (cached) return cached

  const entry = runtime.registry.entries.get(appId)
  const pending: Promise<LoadFailure | null> = entry
    ? runtime.loader
        .load(entry, { signal: new AbortController().signal })
        .then(() => null)
        .catch((error: LoadFailure) => error)
    : Promise.resolve({
        id: appId,
        code: 'registry/invalid-descriptor',
        message: `No application is registered as "${appId}". Check the id against registry.json, or add a localStorage override pointing at your dev server.`,
      })

  attempts.set(appId, pending)
  return pending
}

function Failure({ error, retry }: { readonly error: LoadFailure; readonly retry: () => void }) {
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
  // The boundary serves `/`, `/$appId` and `/$appId/$`, so the id comes from
  // the loose params bag, which TanStack types as `any` without a registered
  // router instance.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const appId: string = useParams({ strict: false }).appId ?? ''
  const [attempt, setAttempt] = useState(0)

  const retry = (): void => {
    attempts.delete(appId)
    setAttempt(current => current + 1)
  }

  return (
    <Suspense
      fallback={
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Spinner />
            </EmptyMedia>
            <EmptyTitle>Loading {appId}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      }
    >
      <Mounted key={attempt} appId={appId} retry={retry} />
    </Suspense>
  )
}

function Mounted({
  appId,
  retry,
}: {
  readonly appId: string
  readonly retry: () => void
}): ReactNode {
  const runtime = useMfeRuntime('the App boundary')
  const error = use(resolveOnce(runtime, appId))
  if (error) return <Failure error={error} retry={retry} />

  // Everything below the boundary is the App's: no padding, no card, no page
  // header. `fallback` still covers a failure raised while mounting.
  return (
    <AppHost
      appId={appId}
      basePath={`/${appId}`}
      fallback={props => <Failure error={props.error} retry={props.retry} />}
    />
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
