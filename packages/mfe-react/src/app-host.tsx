/**
 * Hosting an App: the declarative route form and the imperative escape hatch.
 *
 * Apps take URLs, so a parent delegates to a child App at a splat route: the
 * boundary is visible in the filename rather than derived from whatever route
 * happens to be active, and because that is an ordinary route the child loads
 * through native code splitting and `defaultPreload: 'intent'` preloads it.
 */

import type { MfeError } from '@company/mfe-core'
import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { AppMount } from './app-mount.tsx'
import { createMount } from './create-runtime.ts'
import { forgetDefinition, loadDefinition, RetryBoundary } from './remote-definition.tsx'
import { useMfeRuntime } from './runtime-context.tsx'
import { useOptionalMfeMount } from './mount-context.tsx'

export interface AppFallbackProps {
  readonly error: MfeError
  readonly retry: () => void
}

export interface AppHostProps {
  readonly appId: string
  /** The URL boundary assigned to this child. Everything below it is the child's. */
  readonly basePath: string
  readonly fallback?: (props: AppFallbackProps) => ReactNode
}

/**
 * Shell-owned imperative placement, for cases like opening an App inside a
 * shell-owned modal. It is the escape hatch; `mfeRoute` is the author path.
 */
export function AppHost({ appId, basePath, fallback }: AppHostProps): ReactNode {
  const runtime = useMfeRuntime(`the "${appId}" App`)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    forgetDefinition(runtime, appId)
    setAttempt(current => current + 1)
  }, [runtime, appId])

  const body = <AppLoader key={attempt} appId={appId} basePath={basePath} />

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

  // A change to the boundary, the definition id or the React placement key
  // disposes the old mount and creates a new one; a change to child-owned path
  // or search parameters does not reach here at all, because that is an ordinary
  // route transition inside the child's own router.
  const handle = useMemo(
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

  useEffect(() => {
    return () => {
      void handle.dispose()
    }
  }, [handle])

  return <AppMount definition={definition} mount={handle.mount} bridge={runtime.navigator} />
}

export interface MfeRouteOptions {
  readonly appId: string
  /**
   * Overrides the boundary the parent route would otherwise supply. Advanced:
   * the default derives it from the host route, which is what keeps the child
   * contract identical whether it is top-level or nested.
   */
  readonly basePath?: string
}

/**
 * Declares a child App at a splat route. Returns ordinary route options, so the
 * author's own options merge with it and the child fails through the route's
 * native `errorComponent`.
 */
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
 * The splat route `/reports/$` is matched at `/reports`, so the host route's own
 * pathname is the child's boundary when no override was given.
 */
function MfeRouteBoundary({
  appId,
  basePath,
}: {
  readonly appId: string
  readonly basePath: string | undefined
}): ReactNode {
  const runtime = useMfeRuntime(`the "${appId}" App`)
  const resolved = basePath ?? runtime.navigator.read().pathname

  return <AppHost appId={appId} basePath={resolved} />
}
