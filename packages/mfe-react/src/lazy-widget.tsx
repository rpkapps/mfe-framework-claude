/**
 * Consuming a Widget: what looks like an ordinary lazy component.
 *
 * Inputs are props and events are `onX` props, so a consumer writes React
 * rather than learning a loading model. `lazyWidget` is called at module scope
 * for a stable component identity: creating it during render would remount the
 * Widget, throwing away its state, on every parent render.
 */

import type { ContractEvents, ContractInputs, MfeError, WidgetContract } from '@company/mfe-core'
import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { createMount } from './create-runtime.ts'
import { forgetDefinition, loadDefinition, RetryBoundary } from './remote-definition.tsx'
import { useMfeRuntime } from './runtime-context.tsx'
import { declaredEventNames, partitionWidgetProps, WidgetMount } from './widget-mount.tsx'

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
    const runtime = useMfeRuntime(`the "${widgetId}" Widget`)
    const [attempt, setAttempt] = useState(0)
    const retry = useCallback(() => {
      forgetDefinition(runtime, widgetId)
      setAttempt(current => current + 1)
    }, [runtime])

    const body = (
      <WidgetLoader key={attempt} widgetId={widgetId} contract={contract} props={props} />
    )

    return fallback ? (
      <RetryBoundary
        fallback={fallback}
        retry={retry}
        resetKey={attempt}
        id="<widget>"
        operation="mount Widget"
      >
        {body}
      </RetryBoundary>
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
}: {
  readonly widgetId: string
  readonly contract: WidgetContract | undefined
  readonly props: Record<string, unknown>
}): ReactNode {
  const runtime = useMfeRuntime(`the "${widgetId}" Widget`)
  const definition = use(loadDefinition(runtime, widgetId, 'widget'))

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
  const { inputs, handlers } = partitionWidgetProps(props, declaredEventNames(definition.contract))

  return (
    <WidgetMount
      definition={definition}
      mount={handle.mount}
      inputs={inputs}
      handlers={handlers}
      consumerEvents={contract?.events}
    />
  )
}
