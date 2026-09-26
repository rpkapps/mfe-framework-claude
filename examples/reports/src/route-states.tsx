/** The shell's boundary fallback is for an App that could not be loaded; by the time a route loader
 * throws, this App is loaded and running, so these are its own to show. */

import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { useMatch, useRouter } from '@tanstack/react-router'
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
import { FileQuestionIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** A route can throw anything, so the message is derived rather than read off `error.message`. */
export function RouteError({ error, reset }: { error: unknown; reset: () => void }): ReactNode {
  const router = useRouter()
  const queryErrorResetBoundary = useQueryErrorResetBoundary()
  // A loader that threw leaves its match in error; a component that threw while rendering does not.
  const loadFailed = useMatch({ strict: false, select: match => match.status === 'error' })
  const message = error instanceof Error ? error.message : String(error)

  /**
   * `reset` alone only clears this boundary: the match still holds the loader's error and throws it
   * again, so the loader has to run again first. Query's boundary is reset before that, or a
   * suspense query that already failed would not refetch.
   */
  async function retry(): Promise<void> {
    queryErrorResetBoundary.reset()
    await router.invalidate()
    reset()
  }

  return (
    <div className="flex h-full w-full">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>
            {loadFailed ? 'This page could not load its data' : 'This page ran into an error'}
          </EmptyTitle>
          <EmptyDescription className="max-w-prose whitespace-pre-wrap">{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            onPress={() => {
              void retry()
            }}
          >
            <RotateCcwIcon /> Try again
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

export function RouteNotFound(): ReactNode {
  return (
    <div className="flex h-full w-full">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestionIcon />
          </EmptyMedia>
          <EmptyTitle>No such page</EmptyTitle>
          <EmptyDescription>
            This application has no route for that URL. The boundary above it belongs to the shell;
            everything after it belongs here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

export function RoutePending(): ReactNode {
  return (
    <div className="m-auto">
      <Spinner />
    </div>
  )
}
