/**
 * Hosting an App: a parent delegates at a splat route, so the boundary is visible in the
 * filename and the child loads through the router's own code splitting and preloading.
 */

import type { MfeError } from '@company/mfe-core'
import { useParams } from '@tanstack/react-router'
import { use, useCallback, useState, type ReactNode } from 'react'

import { AppMount } from './app-mount.tsx'
import { createMount, useOwnedMount } from './create-runtime.ts'
import { forgetDefinition, loadDefinition, RetryBoundary } from './remote-definition.tsx'
import { useMfeRuntime } from './runtime-context.tsx'
import { useOptionalMfeMount } from './mount-context.tsx'

export interface AppFallbackProps {
  readonly error: MfeError
  readonly retry: () => void
}

export interface AppHostProps {
  readonly appId: string
  /** The URL boundary assigned to this child; everything below it is the child's. */
  readonly basePath: string
  readonly fallback?: (props: AppFallbackProps) => ReactNode
}

/** The imperative escape hatch for shell-owned placement; `mfeRoute` is the author path. */
export function AppHost({ appId, basePath, fallback }: AppHostProps): ReactNode {
  const runtime = useMfeRuntime(`the "${appId}" App`)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    forgetDefinition(runtime, appId)
    setAttempt(current => current + 1)
  }, [runtime, appId])

  // The key carries the App and its boundary: without them React reconciles one `AppLoader`
  // across a change of App, and `useOwnedMount` still holds the old mount for that render (§14).
  const body = (
    <AppLoader key={`${String(attempt)}:${appId}:${basePath}`} appId={appId} basePath={basePath} />
  )

  return fallback ? (
    <RetryBoundary
      fallback={fallback}
      retry={retry}
      resetKey={attempt}
      id="<app>"
      operation="mount App"
    >
      {body}
    </RetryBoundary>
  ) : (
    body
  )
}

function AppLoader({
  appId,
  basePath,
}: {
  readonly appId: string
  readonly basePath: string
}): ReactNode {
  const runtime = useMfeRuntime(`the "${appId}" App`)
  const parent = useOptionalMfeMount()
  const definition = use(loadDefinition(runtime, appId, 'app'))

  // Child-owned path and search changes never reach here; they are ordinary route
  // transitions inside the child's own router.
  const mount = useOwnedMount(
    () =>
      createMount({
        runtime,
        definitionId: definition.id,
        ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
        kind: 'app',
        basePath,
        depth: (parent?.depth ?? 0) + 1,
      }),
    [runtime, definition, basePath, parent],
  )

  // The one render before the effect has built the mount.
  if (mount === null) return null

  return <AppMount definition={definition} mount={mount} bridge={runtime.navigator} />
}

export interface MfeRouteOptions {
  readonly appId: string
  /** Overrides the boundary; the default derives it from the host route, top-level or nested. */
  readonly basePath?: string
}

/** Returns ordinary route options, so the author's own merge in and errors reach `errorComponent`. */
export function mfeRoute(options: MfeRouteOptions): {
  component: () => ReactNode
} {
  return {
    component: function MfeRouteComponent(): ReactNode {
      return <MfeRouteBoundary appId={options.appId} basePath={options.basePath} />
    },
  }
}

/**
 * The boundary a delegated child is mounted at: the current path with the splat remainder
 * removed, because the whole pathname would hand the child its own deep link as a base.
 */
export function boundaryAboveSplat(pathname: string, splat: string | undefined): string {
  const trimmed = pathname.replace(/\/+$/, '')
  if (splat === undefined || splat === '') return trimmed === '' ? '/' : trimmed

  const remainder = `/${splat.replace(/^\/+/, '')}`
  const boundary = trimmed.endsWith(remainder) ? trimmed.slice(0, -remainder.length) : trimmed
  return boundary === '' ? '/' : boundary
}

function MfeRouteBoundary({
  appId,
  basePath,
}: {
  readonly appId: string
  readonly basePath: string | undefined
}): ReactNode {
  const runtime = useMfeRuntime(`the "${appId}" App`)
  // Read as a plain bag: the typed shape comes from the consuming project's router, whose
  // own routes may have no splat at all.
  const params = useParams({ strict: false }) as unknown as Record<string, string | undefined>
  const splat = params['_splat']
  const resolved = basePath ?? boundaryAboveSplat(runtime.navigator.read().pathname, splat)

  return <AppHost appId={appId} basePath={resolved} />
}
