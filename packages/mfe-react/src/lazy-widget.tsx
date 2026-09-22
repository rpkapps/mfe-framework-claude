/**
 * Consuming a Widget as an ordinary lazy component; `lazyWidget` is called at module scope
 * because a component created during render remounts the Widget on every parent render (§15).
 */

import type { ContractEvents, ContractInputs, MfeError, WidgetContract } from '@company/mfe-core'
import { Suspense, use, useCallback, useState, type ReactNode } from 'react'

import { createMount, useOwnedMount } from './create-runtime.ts'
import { forgetDefinition, loadDefinition, RetryBoundary } from './remote-definition.tsx'
import { useMfeRuntime } from './runtime-context.tsx'
import { declaredEventNames, partitionWidgetProps, WidgetMount } from './widget-mount.tsx'

/** What the `fallback` slot receives, the one documented inline failure seam. */
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
  /** What fills this Widget's box while its container is fetched; the default is nothing. */
  readonly pending?: ReactNode
}

export interface LazyWidgetOptions<C extends WidgetContract> {
  /** Enables consumer-side event validation and infers prop and handler types (§15). */
  readonly contract?: C
}

/**
 * The id-only form is listed first so `lazyWidget('alert-panel')` resolves to it; one signature
 * with an optional contract would type that call from a contract nobody supplied.
 */
export function lazyWidget(widgetId: string): (props: LazyWidgetProps<undefined>) => ReactNode

export function lazyWidget<C extends WidgetContract>(
  widgetId: string,
  options: LazyWidgetOptions<C>,
): (props: LazyWidgetProps<C>) => ReactNode

export function lazyWidget(
  widgetId: string,
  options: LazyWidgetOptions<WidgetContract> = {},
): (props: Record<string, unknown>) => ReactNode {
  const { contract } = options

  function LazyWidget(props: Record<string, unknown>): ReactNode {
    return <WidgetBoundary widgetId={widgetId} contract={contract} props={props} />
  }

  LazyWidget.displayName = `LazyWidget(${widgetId})`
  return LazyWidget
}

/**
 * A Widget whose id is a value rather than a name in the source, for a host composing what the
 * registry names; the contract-free mode by construction (§15). Keying the element by the
 * id replaces the mount instead of feeding another Widget's inputs into the one already there.
 */
export interface DynamicWidgetProps extends LazyWidgetProps<undefined> {
  readonly widgetId: string
  /**
   * Every event this Widget declares, delivered by name, for a consumer that knows them only
   * as strings read from a published contract (§28).
   */
  readonly onEvent?: (name: string, payload: unknown) => void
}

export function DynamicWidget({ widgetId, ...props }: DynamicWidgetProps): ReactNode {
  return <WidgetBoundary key={widgetId} widgetId={widgetId} contract={undefined} props={props} />
}

/** Module scope rather than a closure per call, so no component is created during render. */
function WidgetBoundary({
  widgetId,
  contract,
  props,
}: {
  readonly widgetId: string
  readonly contract: WidgetContract | undefined
  readonly props: Record<string, unknown>
}): ReactNode {
  const fallback = props['fallback'] as ((props: WidgetFallbackProps) => ReactNode) | undefined
  const pending = props['pending'] as ReactNode
  const runtime = useMfeRuntime(`the "${widgetId}" Widget`)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    forgetDefinition(runtime, widgetId)
    setAttempt(current => current + 1)
  }, [runtime, widgetId])

  // Without a boundary here, one Widget's load would suspend the whole consuming page.
  const body = (
    <Suspense fallback={pending}>
      <WidgetLoader key={attempt} widgetId={widgetId} contract={contract} props={props} />
    </Suspense>
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

  const mount = useOwnedMount(
    () =>
      createMount({
        runtime,
        definitionId: definition.id,
        ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
        kind: 'widget',
      }),
    [runtime, definition],
  )

  // Event names come from the provider's own contract, so a consumer without one still works.
  const { inputs, handlers } = partitionWidgetProps(props, declaredEventNames(definition.contract))

  // The one render before the effect has built the mount.
  if (mount === null) return null

  return (
    <WidgetMount
      definition={definition}
      mount={mount}
      inputs={inputs}
      handlers={handlers}
      consumerEvents={contract?.events}
    />
  )
}
