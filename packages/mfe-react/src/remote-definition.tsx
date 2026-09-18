/**
 * Resolving a definition from the registry, and the retry boundary around it —
 * the plumbing `AppHost` and `lazyWidget` share.
 *
 * Loads are cached per runtime so two consumers of one id suspend on the same
 * promise, and a failed load is dropped again so retry is a fresh attempt.
 */

import { toMfeError, type MfeError } from '@company/mfe-core'
import { Component, type ReactNode } from 'react'

import {
  isMfeDefinition,
  type AppDefinition,
  type MfeDefinition,
  type WidgetDefinition,
} from './definition.ts'
import type { MfeRuntime } from './runtime.ts'

const loadsByRuntime = new WeakMap<MfeRuntime, Map<string, Promise<MfeDefinition>>>()

export function loadDefinition(runtime: MfeRuntime, id: string, kind: 'app'): Promise<AppDefinition>
export function loadDefinition(
  runtime: MfeRuntime,
  id: string,
  kind: 'widget',
): Promise<WidgetDefinition>
export function loadDefinition(
  runtime: MfeRuntime,
  id: string,
  kind: 'app' | 'widget',
): Promise<MfeDefinition> {
  let loads = loadsByRuntime.get(runtime)
  if (!loads) {
    loads = new Map()
    loadsByRuntime.set(runtime, loads)
  }

  const cached = loads.get(id)
  if (cached) return cached

  const label = kind === 'app' ? 'App' : 'Widget'
  const entry = runtime.registry.entries.get(id)

  const pending = (async (): Promise<MfeDefinition> => {
    if (!entry) {
      throw toMfeError(null, {
        code: 'registry/invalid-descriptor',
        id,
        operation: `resolve ${label}`,
        observed: 'no registry entry with this id',
        declaredBy: 'The shell registry',
        repair:
          'Check the id against the generated registry descriptor, or add a localStorage override pointing at your dev server.',
      })
    }

    const loaded = await runtime.loader.load(entry, { signal: new AbortController().signal })
    const definition = loaded.module

    if (!isMfeDefinition(definition) || definition.kind !== kind) {
      throw toMfeError(null, {
        code: 'load/entry-failure',
        id,
        operation: `resolve ${label}`,
        expected: `a definition created with create${label}`,
        observed: !isMfeDefinition(definition)
          ? 'a module that is not a framework definition'
          : kind === 'app'
            ? 'a Widget definition, which owns no URL boundary'
            : 'an App definition',
        declaredBy: 'The framework definition contract',
        repair: `Export the ${label} from src/mfe.ts and rebuild the container.`,
      })
    }

    return definition
  })()

  pending.catch(() => loads.delete(id))
  loads.set(id, pending)
  return pending
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

/** Holds the raw value so the props-dependent normalization can happen in render. */
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
