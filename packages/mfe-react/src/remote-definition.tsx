/**
 * Resolving a definition from the registry, and the retry boundary around it. A rejection stays
 * cached because React needs the same settled promise to surface the failure, and a cache that
 * evicted itself would suspend forever and refetch as fast as the network allows.
 */

import { isBrandedDefinition, toMfeError, type MfeError } from '@company/mfe-core'
import {
  isMountableDefinition,
  type MountableAppDefinition,
  type MountableDefinition,
  type MountableWidgetDefinition,
} from '@company/mfe-runtime'
import { Component, type ReactNode } from 'react'

import {
  isReactDefinition,
  type AppDefinition,
  type MfeDefinition,
  type WidgetDefinition,
} from './definition.ts'
import type { MfeRuntime } from './runtime.ts'

/** What a React host can place: a definition it renders, or one that mounts itself. */
type HostableDefinition = MfeDefinition | MountableDefinition

const loadsByRuntime = new WeakMap<MfeRuntime, Map<string, Promise<HostableDefinition>>>()

export function loadDefinition(
  runtime: MfeRuntime,
  id: string,
  kind: 'app',
): Promise<AppDefinition | MountableAppDefinition>
export function loadDefinition(
  runtime: MfeRuntime,
  id: string,
  kind: 'widget',
): Promise<WidgetDefinition | MountableWidgetDefinition>
export function loadDefinition(
  runtime: MfeRuntime,
  id: string,
  kind: 'app' | 'widget',
): Promise<HostableDefinition> {
  let loads = loadsByRuntime.get(runtime)
  if (!loads) {
    loads = new Map()
    loadsByRuntime.set(runtime, loads)
  }

  const cached = loads.get(id)
  if (cached) return cached

  const label = kind === 'app' ? 'App' : 'Widget'
  const entry = runtime.registry.entries.get(id)

  const pending = (async (): Promise<HostableDefinition> => {
    if (!entry) {
      throw toMfeError(null, {
        code: 'registry/invalid-entry',
        id,
        operation: `resolve ${label}`,
        observed: 'no registry entry with this id',
        repair:
          'Check the id against the generated registry entry, or add a localStorage override pointing at your dev server.',
      })
    }

    const loaded = await runtime.loader.load(entry, { signal: new AbortController().signal })
    const definition = loaded.module
    const hostable = isReactDefinition(definition) || isMountableDefinition(definition)

    if (!hostable || definition.kind !== kind) {
      throw toMfeError(null, {
        code: 'load/entry-failure',
        id,
        operation: `resolve ${label}`,
        expected: `a definition created with create${label}`,
        observed: !hostable
          ? describeUnhostable(definition)
          : kind === 'app'
            ? 'a Widget definition, which owns no URL boundary'
            : 'an App definition',
        repair: `Export the ${label} from src/mfe.ts and rebuild the container.`,
      })
    }

    return definition
  })()

  // Marks the rejection handled without dropping it, and reports off the cached promise so one
  // attempt is one diagnostic however many consumers suspend on it.
  pending.catch((error: unknown) => {
    runtime.diagnostics.report(
      toMfeError(error, { code: 'load/entry-failure', id, operation: `resolve ${label}` }),
    )
  })
  loads.set(id, pending)
  return pending
}

/** A foreign definition is placed only through `mount`, so one without it cannot be hosted. */
function describeUnhostable(value: unknown): string {
  return isBrandedDefinition(value)
    ? `a definition from the ${value.framework} adapter that cannot mount itself`
    : 'a module that is not a framework definition'
}

/** Drops a cached outcome so the next load is a genuinely fresh attempt. */
export function forgetDefinition(runtime: MfeRuntime, id: string): void {
  loadsByRuntime.get(runtime)?.delete(id)
}

interface RetryBoundaryProps {
  readonly children: ReactNode
  readonly fallback: (props: { readonly error: MfeError; readonly retry: () => void }) => ReactNode
  readonly retry: () => void
  /** Remounting on a change is what makes retry a genuinely fresh attempt. */
  readonly resetKey: number
  readonly id: string
  readonly operation: string
}

/** Holds the raw value so the props-dependent coercion can happen in render. */
interface RetryBoundaryState {
  readonly thrown: { readonly value: unknown } | null
}

/** Suspense is not an error handler, so the inline `fallback` slot needs this. */
export class RetryBoundary extends Component<RetryBoundaryProps, RetryBoundaryState> {
  override state: RetryBoundaryState = { thrown: null }

  static getDerivedStateFromError(error: unknown): RetryBoundaryState {
    return { thrown: { value: error } }
  }

  override componentDidUpdate(previous: RetryBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.thrown !== null) {
      this.setState({ thrown: null })
    }
  }

  override render(): ReactNode {
    const { thrown } = this.state
    if (thrown === null) return this.props.children

    return this.props.fallback({
      error: toMfeError(thrown.value, {
        code: 'mount/failure',
        id: this.props.id,
        operation: this.props.operation,
      }),
      retry: this.props.retry,
    })
  }
}
