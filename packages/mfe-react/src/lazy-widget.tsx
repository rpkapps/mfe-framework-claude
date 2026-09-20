/**
 * Consuming a Widget: what looks like an ordinary lazy component.
 *
 * Inputs are props and events are `onX` props, so a consumer writes React
 * rather than learning a loading model. `lazyWidget` is called at module scope
 * for a stable component identity: creating it during render would remount the
 * Widget, throwing away its state, on every parent render.
 */

import type { ContractEvents, ContractInputs, MfeError, WidgetContract } from '@company/mfe-core'
import { Suspense, use, useCallback, useState, type ReactNode } from 'react'

import { createMount, useOwnedMount } from './create-runtime.ts'
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
  /**
   * What occupies this Widget's box while its container is being fetched. A
   * skeleton of roughly the right size is the useful answer; the default is
   * nothing, because the framework ships no CSS and will not guess at a
   * consumer's design system.
   */
  readonly pending?: ReactNode
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

/**
 * Called with a contract, the props and handlers are typed from it. Called with
 * an id alone — which is what a host composing whatever the registry advertises
 * can do — inputs are `Record<string, unknown>` and payloads are `unknown`.
 *
 * The id-only form is listed first and takes no second argument, so
 * `lazyWidget('alert-panel')` resolves to it. Making the contract optional on
 * one signature instead would match the id-only call as well, infer the
 * contract as its own constraint, and hand back a component whose props are
 * typed from a contract nobody supplied.
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
 * A Widget whose id is a value rather than a name in the source.
 *
 * `lazyWidget` covers the ordinary case, where a consumer knows at build time
 * which Widget it consumes. A host composing what the registry advertises does
 * not: a dashboard, a catalogue, a layout a user assembled. It cannot call
 * `lazyWidget` per id either, because that has to happen at module scope and
 * the ids are not known until the registry is read — which is why this is a
 * component taking the id as a prop, and not a factory a host is told to cache.
 *
 * It is the contract-free mode by construction. A typed contract is a
 * compile-time relationship between one consumer and one provider, and a host
 * that discovers its Widgets at runtime has no such relationship. The provider
 * still validates every input and every event payload it emits, so the
 * boundary is exactly as strong; only the consumer's types are weaker, and the
 * registry publishes the input schema for a host that needs the shape.
 *
 * The element is keyed by the id, so naming a different Widget replaces the
 * mount rather than feeding another Widget's inputs into the one already there.
 */
export interface DynamicWidgetProps extends LazyWidgetProps<undefined> {
  readonly widgetId: string
  /**
   * Every event this Widget declares, delivered by name. For the consumer that
   * cannot write an `onX` prop because it knows the events only as strings read
   * from a published contract; subscribing then meant rebuilding the
   * framework's own `on` + capitalized-name mapping in the host.
   *
   * Deliberately not on `lazyWidget`, where a contract makes every event a
   * typed prop and a catch-all would only be a weaker second way to say it. An
   * event with its own `onX` prop reaches both.
   */
  readonly onEvent?: (name: string, payload: unknown) => void
}

export function DynamicWidget({ widgetId, ...props }: DynamicWidgetProps): ReactNode {
  return <WidgetBoundary key={widgetId} widgetId={widgetId} contract={undefined} props={props} />
}

/**
 * Everything both forms share. A module-scope component rather than a closure
 * built per call, so nothing above it is creating a component during render —
 * which would reset the Widget's state on each pass.
 */
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

  /*
   * A Widget's load suspends, and a suspension is caught by the nearest
   * boundary above it — which, without this one, is whatever the consuming
   * page happens to have. Mounting one Widget, or retrying one that failed,
   * therefore replaced the entire page with its fallback and flickered
   * everything else back in afterwards.
   *
   * The boundary belongs here, with the Widget, because the thing being loaded
   * is this box and nothing else. `pending` is what fills the box meanwhile.
   */
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

  // Event names come from the provider's own contract, so a consumer without a
  // runtime contract still gets its `onX` props — and its catch-all — routed
  // correctly.
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
