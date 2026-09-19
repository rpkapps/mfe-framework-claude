/**
 * The boundary: the one place the shell hands the page over to an App.
 *
 * Below this component the shell renders nothing of its own — no padding, no
 * card, no page title. The mounted App gets the region and chooses its own
 * layout, which is why the mount root itself is layout-neutral.
 *
 * Components only, so React Refresh can replace this module in place. The
 * router that uses it is a separate module for the same reason.
 */

import { Suspense, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'
import { AppHost, type MfeError } from '@company/mfe-react'
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

export function AppBoundary(): ReactNode {
  // Three routes share this component, so the id comes from the loose params
  // bag, which TanStack types as `any` without a registered router instance.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const appId: string = useParams({ strict: false }).appId ?? ''

  // `fallback` covers an unresolvable id and a mount-time failure alike, and
  // its retry is a genuinely fresh attempt.
  return (
    <Suspense fallback={<Loading appId={appId} />}>
      <AppHost
        appId={appId}
        basePath={`/${appId}`}
        fallback={props => <MountFailure error={props.error} retry={props.retry} />}
      />
    </Suspense>
  )
}

/**
 * What the boundary shows while a container is on the wire.
 *
 * A bare spinner in the middle of an empty region says nothing about what is
 * happening or how long it might take — and on a slow connection it is the
 * whole page for several seconds. This says which application is being
 * fetched, in the same frame the failure and the empty states use, so the
 * region keeps its shape whichever way the load ends.
 */
function Loading({ appId }: { readonly appId: string }): ReactNode {
  return (
    <div className="flex h-full w-full" role="status" aria-live="polite">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Loading {appId}</EmptyTitle>
          <EmptyDescription>
            Fetching the container this application is deployed in. Its code is not part of the
            shell&apos;s build, so this is the first time this page has asked for it.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

/**
 * An App that will not load is the failure a shell has to survive well: the
 * chrome stays, the other Apps stay reachable, and the error names the
 * definition, what went wrong and the repair.
 */
function MountFailure({
  error,
  retry,
}: {
  readonly error: MfeError
  readonly retry: () => void
}): ReactNode {
  return (
    // The Empty owns its own box; the wrapper is this page's layout.
    <div className="flex h-full w-full">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PlugZapIcon />
          </EmptyMedia>
          <EmptyTitle>{error.id} could not be loaded</EmptyTitle>
          <EmptyDescription className="max-w-prose whitespace-pre-wrap">
            {error.message}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onPress={retry}>
            <RotateCcwIcon /> Retry
          </Button>
          <code className="font-mono text-xs text-muted-foreground">{error.code}</code>
        </EmptyContent>
      </Empty>
    </div>
  )
}
