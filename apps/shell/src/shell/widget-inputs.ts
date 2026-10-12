/**
 * Inputs the shell did not write, from the agent or from a user's JSON, spread onto
 * `DynamicWidget`. A name that is one of its own props would otherwise choose which Widget mounts
 * (`widgetId`), which instance's storage it reads (`instanceId`) or what renders on a failure.
 */

import { isReservedInputName } from '@company/mfe-react'

/** `DynamicWidget`'s own props that are not host control props of every Widget host. */
const DYNAMIC_WIDGET_PROPS = new Set(['widgetId', 'children'])

export function widgetInputsOnly(
  inputs: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inputs).filter(
      ([name]) => !DYNAMIC_WIDGET_PROPS.has(name) && !isReservedInputName(name),
    ),
  )
}
