/**
 * Consuming a Widget as an ordinary component; `lazyWidget` is called at module scope because a
 * component created during render remounts the Widget on every parent render (§15). The Widget
 * mounts itself into an element this renders, whichever framework built it.
 */

import type { ContractOutputs, ContractInputs, MfeError, WidgetContract } from '@company/mfe-core'
import type { ReactNode } from 'react'

import { DefinitionSlot } from './definition-slot.tsx'
import { useDefinitionMount } from './use-definition-mount.ts'
import { deliverWidgetOutput, widgetInputs } from './widget-props.ts'

/** What the `fallback` slot receives, the one documented inline failure seam. */
export interface WidgetFallbackProps {
  readonly error: MfeError
  readonly retry: () => void
}

type HandlerProps<C extends WidgetContract> = {
  readonly [K in keyof ContractOutputs<C> & string as `on${Capitalize<K>}`]?: (
    payload: ContractOutputs<C>[K],
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
  /** Enables consumer-side output validation and infers prop and handler types (§15). */
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
    return <WidgetSlot widgetId={widgetId} contract={contract} props={props} />
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
   * Every output this Widget declares, delivered by name, for a consumer that knows them only
   * as strings read from a published contract (§28).
   */
  readonly onOutput?: (name: string, payload: unknown) => void
}

export function DynamicWidget({ widgetId, ...props }: DynamicWidgetProps): ReactNode {
  return <WidgetSlot key={widgetId} widgetId={widgetId} contract={undefined} props={props} />
}

/** Module scope rather than a closure per call, so no component is created during render. */
function WidgetSlot({
  widgetId,
  contract,
  props,
}: {
  readonly widgetId: string
  readonly contract: WidgetContract | undefined
  readonly props: Record<string, unknown>
}): ReactNode {
  const { element, state, retry } = useDefinitionMount(
    {
      kind: 'widget',
      definitionId: widgetId,
      inputs: widgetInputs(props),
      onOutput: (output, payload) => {
        deliverWidgetOutput(props, output, payload)
      },
      consumerOutputs: contract?.outputSchema,
    },
    `the "${widgetId}" Widget`,
  )

  return (
    <DefinitionSlot
      element={element}
      state={state}
      retry={retry}
      pending={props['pending'] as ReactNode}
      fallback={props['fallback'] as ((props: WidgetFallbackProps) => ReactNode) | undefined}
    />
  )
}
