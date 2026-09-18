/**
 * Hosting an App: the declarative route form and the imperative escape hatch.
 *
 * Apps take URLs and Widgets take props. A parent therefore delegates to a
 * child App at a splat route, so the boundary is visible in the filename rather
 * than derived implicitly from whatever route happens to be active. Because
 * that is an ordinary route, the child loads through native route-level code
 * splitting and `defaultPreload: 'intent'` preloads its manifest on hover with
 * no extra machinery.
 */

import { toMfeError, type MfeError } from '@company/mfe-core'
import { Component, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { AppMount } from './app-mount.tsx'
import { createMount } from './create-runtime.ts'
import { isMfeDefinition, type AppDefinition } from './definition.ts'
import { useMfeRuntime } from './runtime-context.tsx'
import { useOptionalMfeMount } from './mount-context.tsx'
import type { MfeRuntime } from './runtime.ts'

export interface AppFallbackProps {
  readonly error: MfeError
  readonly retry: () => void
}

const loadsByRuntime = new WeakMap<MfeRuntime, Map<string, Promise<AppDefinition>>>()

function loadApp(runtime: MfeRuntime, appId: string): Promise<AppDefinition> {
  let loads = loadsByRuntime.get(runtime)
  if (!loads) {
    loads = new Map()
    loadsByRuntime.set(runtime, loads)
  }

  const cached = loads.get(appId)
  if (cached) return cached

  const entry = runtime.registry.entries.get(appId)
  const pending = (async (): Promise<AppDefinition> => {
    if (!entry) {
      throw toMfeError(null, {
        code: 'registry/invalid-descriptor',
        id: appId,
        operation: 'resolve App',
        observed: 'no registry entry with this id',
        declaredBy: 'The shell registry',
        repair:
          'Check the id against the generated registry descriptor, or add a localStorage override pointing at your dev server.',
      })
    }

    const loaded = await runtime.loader.load(entry, { signal: new AbortController().signal })
    const definition = loaded.module

    if (!isMfeDefinition(definition) || definition.kind !== 'app') {
      throw toMfeError(null, {
        code: 'load/entry-failure',
        id: appId,
        operation: 'resolve App',
        expected: 'a definition created with createApp',
        observed: isMfeDefinition(definition)
          ? 'a Widget definition, which owns no URL boundary'
          : 'a module that is not a framework definition',
        declaredBy: 'The framework definition contract',
        repair:
          'Export the App from src/mfe.ts and rebuild the container. Anything that cannot be expressed as a URL is a Widget, not an App.',
      })
    }

    return definition
  })()

  pending.catch(() => loads.delete(appId))
  loads.set(appId, pending)
  return pending
}

export interface AppHostProps {
  readonly appId: string
  /** The URL boundary assigned to this child. Everything below it is the child's. */
  readonly basePath: string
  readonly fallback?: (props: AppFallbackProps) => ReactNode
}

/**
 * Shell-owned imperative placement, for cases like opening an App inside a
 * shell-owned modal. It is the escape hatch, not the normal author path —
 * `mfeRoute` is.
 */
export function AppHost({ appId, basePath, fallback }: AppHostProps): ReactNode {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(current => current + 1), [])

  const body = <AppLoader key={attempt} appId={appId} basePath={basePath} />

  return fallback ? (
    <AppErrorBoundary fallback={fallback} retry={retry} resetKey={attempt}>
      {body}
    </AppErrorBoundary>
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
  const definition = use(loadApp(runtime, appId))

  // A change to the boundary, the definition id or the React placement key
  // disposes the old mount and creates a new one; a change to child-owned path
  // or search parameters does not reach here at all, because that is an
  // ordinary route transition inside the child's own router.
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

interface BoundaryProps {
  readonly children: ReactNode
  readonly fallback: (props: AppFallbackProps) => ReactNode
  readonly retry: () => void
  readonly resetKey: number
}

class AppErrorBoundary extends Component<BoundaryProps, { error: MfeError | null }> {
  override state: { error: MfeError | null } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: MfeError } {
    return {
      error: toMfeError(error, { code: 'mount/failure', id: '<app>', operation: 'mount App' }),
    }
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null })
    }
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    return this.props.fallback({ error, retry: this.props.retry })
  }
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
 * Declares a child App at a splat route.
 *
 * Returns ordinary route options, so the author's own route options merge with
 * it the way any other route options would, and the child fails through the
 * route's native `errorComponent`.
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
 * Derives the child's boundary from the host route's own pathname when no
 * explicit override was given.
 *
 * The splat route `/reports/$` is matched at `/reports`, so everything below it
 * belongs to the child.
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

export { loadApp }
