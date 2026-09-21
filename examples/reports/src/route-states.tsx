/** The shell's boundary fallback is for an App that could not be loaded; by the time a route loader
 * throws, this App is loaded and running, so these are its own to show. */

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
  const message = error instanceof Error ? error.message : String(error)

  return (
    <div className="flex h-full w-full">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>This page could not load its data</EmptyTitle>
          <EmptyDescription className="max-w-prose whitespace-pre-wrap">{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onPress={reset}>
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
