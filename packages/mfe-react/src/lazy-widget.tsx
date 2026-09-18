/**
 * Consuming a Widget: what looks like an ordinary lazy component.
 *
 * Inputs are props and events are `onX` props, so a consumer writes React
 * rather than learning a loading model. Loading suspends to the nearest
 * `Suspense`; failures reach the nearest error boundary, or the optional
 * `fallback` slot when the consumer wants an inline surface with retry.
 *
 * `lazyWidget` is called at module scope so the component identity is stable.
 * Creating it during render would make React unmount and remount the Widget on
 * every parent render, throwing away its state each time.
 */

import {
  toMfeError,
  type ContractEvents,
  type ContractInputs,
  type MfeError,
  type WidgetContract,
} from '@company/mfe-core'
import { Component, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { createMount } from './create-runtime.ts'
import { isMfeDefinition, type WidgetDefinition } from './definition.ts'
import { useMfeRuntime } from './runtime-context.tsx'
import {
  declaredEventNames,
  partitionWidgetProps,
  WidgetMount,
  type WidgetEventHandlers,
} from './widget-mount.tsx'
import type { MfeRuntime } from './runtime.ts'

/** What the `fallback` slot receives. The single documented inline failure seam. */
export interface WidgetFallbackProps {
  readonly error: MfeError
  readonly retry: () => void
}

type HandlerProps<C extends WidgetContract> = {
  readonly [K in keyof ContractEvents<C> & string as `on${Capitalize<K>}`]?: (
    event: ContractEvents<C>[K],
  ) => void
}

export type LazyWidgetProps<C extends WidgetContract | undefined> = (C extends WidgetContract
  ? ContractInputs<C> & HandlerProps<C>
  : Record<string, unknown>) & {
  readonly fallback?: (props: WidgetFallbackProps) => ReactNode
}

export interface LazyWidgetOptions<C extends WidgetContract> {
  /**
   * Supplying the runtime contract enables consumer-side event validation and
   * infers both prop and handler types. Without it, inputs are
   * `Record<string, unknown>`, payloads are `unknown`, and only the provider
   * validates — a deliberately weaker mode.
   */
  readonly contract?: C
}

/** Per-runtime cache of in-flight and resolved Widget loads. */
const loadsByRuntime = new WeakMap<MfeRuntime, Map<string, Promise<WidgetDefinition>>>()

function loadWidget(runtime: MfeRuntime, widgetId: string): Promise<WidgetDefinition> {
  let loads = loadsByRuntime.get(runtime)
  if (!loads) {
    loads = new Map()
    loadsByRuntime.set(runtime, loads)
  }

  const cached = loads.get(widgetId)
  if (cached) return cached

  const entry = runtime.registry.entries.get(widgetId)
  const pending = (async (): Promise<WidgetDefinition> => {
    if (!entry) {
      throw toMfeError(null, {
        code: 'registry/invalid-descriptor',
        id: widgetId,
        operation: 'resolve Widget',
        observed: 'no registry entry with this id',
        declaredBy: 'The shell registry',
        repair:
          'Check the id against the generated registry descriptor, or add a localStorage override pointing at your dev server.',
      })
    }

    const loaded = await runtime.loader.load(entry, { signal: new AbortController().signal })
    const definition = loaded.module

    if (!isMfeDefinition(definition) || definition.kind !== 'widget') {
      throw toMfeError(null, {
        code: 'load/entry-failure',
        id: widgetId,
        operation: 'resolve Widget',
        expected: 'a definition created with createWidget',
        observed: isMfeDefinition(definition)
          ? 'an App definition'
          : 'a module that is not a framework definition',
        declaredBy: 'The framework definition contract',
        repair: 'Export the Widget from src/mfe.ts and rebuild the container.',
      })
    }

    return definition
  })()

  // A failed load must not be cached as a permanent failure: retry re-runs it.
  pending.catch(() => loads.delete(widgetId))
  loads.set(widgetId, pending)
  return pending
}

export function lazyWidget<C extends WidgetContract>(
  widgetId: string,
  options?: LazyWidgetOptions<C>,
): (props: LazyWidgetProps<C>) => ReactNode

export function lazyWidget(
  widgetId: string,
  options?: LazyWidgetOptions<WidgetContract>,
): (props: LazyWidgetProps<undefined>) => ReactNode

export function lazyWidget(
  widgetId: string,
  options: LazyWidgetOptions<WidgetContract> = {},
): (props: Record<string, unknown>) => ReactNode {
  const { contract } = options

  function LazyWidget(props: Record<string, unknown>): ReactNode {
    const fallback = props['fallback'] as ((props: WidgetFallbackProps) => ReactNode) | undefined
    const [attempt, setAttempt] = useState(0)
    const retry = useCallback(() => setAttempt(current => current + 1), [])

    const body = (
      <WidgetLoader
        key={attempt}
        widgetId={widgetId}
        contract={contract}
        props={props}
        retry={retry}
      />
    )

    return fallback ? (
      <WidgetErrorBoundary fallback={fallback} retry={retry} resetKey={attempt}>
        {body}
      </WidgetErrorBoundary>
    ) : (
      body
    )
  }

  LazyWidget.displayName = `LazyWidget(${widgetId})`
  return LazyWidget
}

function WidgetLoader({
  widgetId,
  contract,
  props,
  retry,
}: {
  readonly widgetId: string
  readonly contract: WidgetContract | undefined
  readonly props: Record<string, unknown>
  readonly retry: () => void
}): ReactNode {
  const runtime = useMfeRuntime(`the "${widgetId}" Widget`)
  const definition = use(loadWidget(runtime, widgetId))

  const handle = useMemo(
    () =>
      createMount({
        runtime,
        definitionId: definition.id,
        ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
        kind: 'widget',
      }),
    [runtime, definition],
  )

  useEffect(() => {
    return () => {
      void handle.dispose()
    }
  }, [handle])

  // Event names come from the provider's own contract, so a consumer without a
  // runtime contract still gets its `onX` props routed correctly.
  const events = declaredEventNames(definition.contract)
  const { inputs, handlers } = partitionWidgetProps(props, events)

  return (
    <WidgetMount
      definition={definition}
      mount={handle.mount}
      inputs={inputs}
      handlers={handlers as WidgetEventHandlers}
      consumerEvents={contract?.events}
      onInputRejected={() => {
        // The update is rejected and the last valid inputs stay rendered; the
        // consumer decides whether to surface a retry.
        void retry
      }}
    />
  )
}

interface BoundaryProps {
  readonly children: ReactNode
  readonly fallback: (props: WidgetFallbackProps) => ReactNode
  readonly retry: () => void
  readonly resetKey: number
}

interface BoundaryState {
  readonly error: MfeError | null
}

/**
 * The inline failure surface behind the `fallback` prop.
 *
 * Suspense is not an error handler, so a real error boundary is required.
 * Remounting on `resetKey` is what makes retry start a genuinely fresh attempt
 * rather than re-rendering the failed one.
 */
class WidgetErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return {
      error: toMfeError(error, {
        code: 'mount/failure',
        id: '<widget>',
        operation: 'mount Widget',
      }),
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
