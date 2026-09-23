/**
 * The provider's half of the Widget boundary as an Angular Widget applies it: the runtime's shared
 * checks, then the two only a component needs — named inputs, each of them one the component
 * declares, because `setInput` would otherwise fail far from here.
 */

import { createMfeError, isRecord, withoutUndefined } from '@company/mfe-core'
import { validateProviderInputs, type ProviderInputs } from '@company/mfe-runtime'

import type { WidgetDefinition } from '../definition.ts'
import { undeclaredInput, type ComponentContract } from './component-contract.ts'

/** Accepted inputs are always named, so each one can be set on the component. */
export type WidgetInputs =
  | { readonly status: 'accepted'; readonly value: Readonly<Record<string, unknown>> }
  | Exclude<ProviderInputs, { readonly status: 'accepted' }>

/** Pure, so an update can validate without touching the mounted component. */
export function validateInputs(
  definition: WidgetDefinition,
  component: ComponentContract,
  inputs: Readonly<Record<string, unknown>>,
): WidgetInputs {
  const checked = validateProviderInputs(definition, inputs)
  if (checked.status !== 'accepted') return checked

  const { value } = checked
  if (!isRecord(value)) {
    return {
      status: 'rejected',
      error: createMfeError({
        code: 'contract/input-mismatch',
        id: definition.id,
        ...withoutUndefined({ definitionVersion: definition.version }),
        operation: 'accept input',
        direction: 'input',
        expected: 'an inputs schema that produces an object of named inputs',
        observed: Array.isArray(value) ? 'an array' : typeof value,
        repair: 'Declare the inputs as z.object({ … }); each key becomes a component input.',
      }),
    }
  }

  const undeclared = Object.keys(value).find(name => !component.inputs.has(name))
  if (undeclared !== undefined) {
    return { status: 'rejected', error: undeclaredInput(definition, component, undeclared) }
  }

  return { status: 'accepted', value }
}
