/**
 * Hosting an App: a parent delegates at a splat route, so the boundary is visible in the
 * filename, and the App mounts itself into an element this renders, whichever framework built it.
 */

import type { MfeError } from '@company/mfe-core'
import { useMatch, useParams, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'

import { DefinitionSlot } from './definition-slot.tsx'
import { useMfeRuntime } from './runtime-context.tsx'
import { useDefinitionMount } from './use-definition-mount.ts'

export interface AppFallbackProps {
  readonly error: MfeError
  readonly retry: () => void
}

export interface AppHostProps {
  readonly appId: string
  /** The URL boundary assigned to this child; everything below it is the child's. */
  readonly basePath: string
  /** Replaces the failed App, with a retry; without it the failure is thrown to the nearest error boundary. */
  readonly fallback?: (props: AppFallbackProps) => ReactNode
  /** What fills the App's region while its container is fetched and it mounts; the default is nothing. */
  readonly pending?: ReactNode
}

/** The imperative escape hatch for shell-owned placement; `mfeRoute` is the author path. */
export function AppHost({ appId, basePath, fallback, pending }: AppHostProps): ReactNode {
  // Keyed, so another App or boundary starts from a fresh pending state rather than showing the
  // state of the mount it replaces for the render before its effect runs.
  return (
    <AppSlot
      key={`${appId}:${basePath}`}
      appId={appId}
      basePath={basePath}
      fallback={fallback}
      pending={pending}
    />
  )
}

function AppSlot({
  appId,
  basePath,
  fallback,
  pending,
}: {
  readonly appId: string
  readonly basePath: string
  readonly fallback: AppHostProps['fallback'] | undefined
  readonly pending: ReactNode
}): ReactNode {
  // Child-owned path and search changes never reach here; they are ordinary route transitions
  // inside the child's own router.
  const { element, state, retry } = useDefinitionMount(
    { kind: 'app', definitionId: appId, basePath },
    `the "${appId}" App`,
  )

  return (
    <DefinitionSlot
      element={element}
      state={state}
      retry={retry}
      pending={pending}
      fallback={fallback}
    />
  )
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
function boundaryAboveSplat(pathname: string, splat: string | undefined): string {
  const trimmed = pathname.replace(/\/+$/, '')
  if (splat === undefined || splat === '') return trimmed === '' ? '/' : trimmed

  const remainder = `/${splat.replace(/^\/+/, '')}`
  const boundary = trimmed.endsWith(remainder) ? trimmed.slice(0, -remainder.length) : trimmed
  return boundary === '' ? '/' : boundary
}

/** The router strips its own basepath from what it matches, so the boundary puts it back. */
function joinBoundary(routerBase: string | undefined, boundary: string): string {
  const base = (routerBase ?? '').replace(/\/+$/, '')
  if (base === '') return boundary
  return boundary === '/' ? base : `${base}${boundary}`
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
  // The match's own path rather than the page's: while a navigation loads, the page has moved
  // and the match has not, and a boundary computed from the two would remount the App.
  const matched = useMatch({ strict: false, select: match => match.pathname })
  const routerBase = useRouter().options.basepath
  const resolved = basePath ?? joinBoundary(routerBase, boundaryAboveSplat(matched, splat))

  // The host's router may move the page without going through the navigator, which no mounted
  // App would otherwise hear of; the navigator tells them only when the page actually moved.
  const href = useRouterState({ select: state => state.location.href })
  useEffect(() => {
    runtime.navigator.announce()
  }, [runtime, href])

  return <AppHost appId={appId} basePath={resolved} />
}
