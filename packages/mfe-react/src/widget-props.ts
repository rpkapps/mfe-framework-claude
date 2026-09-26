/**
 * How a consumer's props divide into a Widget's inputs and its output handlers. The division needs
 * no contract: a handler is an `onX` prop, and an output reaches the prop its name maps to, so a
 * host that knows the Widget only by id splits props exactly as one that imported its contract.
 */

import { outputNameToHandlerProp } from '@company/mfe-core'

type Props = Readonly<Record<string, unknown>>

/** A host composing the registry knows output names only as strings, not as `onX` props. */
const CATCH_ALL_HANDLER_PROP = 'onOutput'

/** Host control props, never forwarded as inputs. */
const CONTROL_PROPS = new Set(['fallback', 'pending', 'key', 'ref'])

/**
 * Everything that is neither a host control prop nor a handler. An `onX` prop with no matching
 * output is dropped here too, because it would fail serializability with a confusing message.
 */
export function widgetInputs(props: Props): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(props)) {
    if (CONTROL_PROPS.has(name) || /^on[A-Z]/.test(name)) continue
    inputs[name] = value
  }
  return inputs
}

/**
 * Calls the output's own handler and then the catch-all, so a consumer asking for all of them and
 * for one in particular gets both. An output whose handler prop would be the catch-all's reaches
 * the catch-all alone, once.
 */
export function deliverWidgetOutput(props: Props, output: string, payload: unknown): void {
  const handlerProp = outputNameToHandlerProp(output)
  if (handlerProp !== CATCH_ALL_HANDLER_PROP) {
    const own = props[handlerProp] as ((payload: unknown) => void) | undefined
    if (typeof own === 'function') own(payload)
  }

  const catchAll = props[CATCH_ALL_HANDLER_PROP] as
    ((output: string, payload: unknown) => void) | undefined
  if (typeof catchAll === 'function') catchAll(output, payload)
}
