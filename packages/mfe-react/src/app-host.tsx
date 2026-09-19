/**
 * Hosting an App: the declarative route form and the imperative escape hatch.
 *
 * Apps take URLs, so a parent delegates to a child App at a splat route: the
 * boundary is visible in the filename rather than derived from whatever route
 * happens to be active, and because that is an ordinary route the child loads
 * through native code splitting and `defaultPreload: 'intent'` preloads it.
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

  /*
   * The key carries the App and its boundary, not just the retry counter.
   *
   * Without them React reconciles one `AppLoader` across a change of App: the
   * new definition resolves, the component re-renders, and `useOwnedMount`
   * still holds the *previous* App's mount — it only swaps in an effect. For
   * that render `AppMount` builds the new App's router from the old App's
   * mount, so the author's factory is handed the previous boundary, the router
   * matches nothing, and the region goes blank. That is precisely what a shell
   * does every time the user switches application from the finder.
   *
   * Keying makes the change a remount: the old subtree unmounts and disposes
   * its mount, the new one starts from no mount at all, and the host's Suspense
   * boundary covers the gap — which is the behaviour the rest of this file
   * already assumes.
   */
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

  // A change to the boundary, the definition id or the React placement key
  // disposes the old mount and creates a new one; a change to child-owned path
  // or search parameters does not reach here at all, because that is an ordinary
  // route transition inside the child's own router.
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

  // The one render before the effect has built the mount. A host renders this
  // inside a Suspense boundary that is already showing a fallback.
  if (mount === null) return null

  return <AppMount definition={definition} mount={mount} bridge={runtime.navigator} />
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
/**
 * The boundary a delegated child is mounted at: the current path with the
 * splat remainder removed.
 *
 * `mfeRoute` is declared at a splat route, so the parent's own path is
 * everything above the splat and the remainder is the child's URL. Taking the
 * whole pathname instead hands the child its own deep link as a base, leaves
 * it nothing to route, and it silently renders its index for every URL below
 * the boundary — which is exactly what a real page did.
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
  // The parent App's own params, read as a plain bag. The typed shape comes
  // from whichever router the *consuming* project registered, which is not the
  // one this component is rendered by: in a project whose own routes have no
  // splat, `_splat` is not on that type at all.
  const params = useParams({ strict: false }) as unknown as Record<string, string | undefined>
  const splat = params['_splat']
  const resolved = basePath ?? boundaryAboveSplat(runtime.navigator.read().pathname, splat)

  return <AppHost appId={appId} basePath={resolved} />
}
