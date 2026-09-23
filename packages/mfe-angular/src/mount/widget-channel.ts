/**
 * The provider's half of the Widget boundary: validating the inputs a host passes and the payloads
 * the Widget emits, against the Widget's own contract. The host checks only what it declared
 * itself, so a failure here is always the provider's to fix.
 */

import {
  createMfeError,
  isReservedInputName,
  validateAgainstContract,
  validateSerializable,
  type ContractValidation,
} from '@company/mfe-core'

import type { WidgetDefinition } from '../definition.ts'
import { undeclaredInput, type ComponentContract } from './component-contract.ts'

function versionOf(definition: WidgetDefinition): { readonly definitionVersion?: string } {
  return definition.version === undefined ? {} : { definitionVersion: definition.version }
}

/** Pure, so an update can validate without touching the mounted component. */
export function validateInputs(
  definition: WidgetDefinition,
  component: ComponentContract,
  inputs: Readonly<Record<string, unknown>>,
): ContractValidation<Readonly<Record<string, unknown>>> {
  const context = {
    id: definition.id,
    ...versionOf(definition),
    direction: 'input' as const,
    side: 'provider' as const,
  }

  const nonSerializable = validateSerializable(inputs, context)
  if (nonSerializable) return { ok: false, error: nonSerializable }

  const result = validateAgainstContract(definition.contract.inputs, inputs, context)
  if (!result.ok) return result

  const value: unknown = result.value
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      error: createMfeError({
        code: 'contract/input-mismatch',
        id: definition.id,
        ...versionOf(definition),
        operation: 'accept input',
        direction: 'input',
        expected: 'an inputs schema that produces an object of named inputs',
        observed: Array.isArray(value) ? 'an array' : typeof value,
        repair: 'Declare the inputs as z.object({ … }); each key becomes a component input.',
      }),
    }
  }

  const record = value as Readonly<Record<string, unknown>>
  for (const name of Object.keys(record)) {
    if (isReservedInputName(name)) {
      return {
        ok: false,
        error: createMfeError({
          code: 'contract/input-mismatch',
          id: definition.id,
          ...versionOf(definition),
          operation: `declare input '${name}'`,
          expected: 'an input name that is not reserved for host control or event handlers',
          observed: `'${name}', which is reserved`,
          repair: 'Rename the input; key, ref, fallback and onX names belong to the host.',
        }),
      }
    }
    if (!component.inputs.has(name)) {
      return { ok: false, error: undeclaredInput(definition, component, name) }
    }
  }

  return { ok: true, value: record }
}

/**
 * The one emit every path goes through. It throws at the call site, which for `injectWidgetEmit`
 * is the provider's own code; the host's `deliver` receives only a validated payload.
 */
export function createWidgetEmitter(
  definition: WidgetDefinition,
  deliver: (event: string, payload: unknown) => void,
): (event: string, payload: unknown) => void {
  const declared = definition.contract.events

  return (event, payload) => {
    const schema = declared[event]
    if (!schema) {
      throw createMfeError({
        code: 'contract/event-mismatch',
        id: definition.id,
        ...versionOf(definition),
        operation: `emit event '${event}'`,
        direction: 'event',
        expected: `one of the declared events (${Object.keys(declared).join(', ') || 'none'})`,
        observed: `'${event}', which this Widget does not declare`,
        repair: `Add '${event}' to the events schema, or emit a declared event.`,
      })
    }

    const context = {
      id: definition.id,
      ...versionOf(definition),
      direction: 'event' as const,
      side: 'provider' as const,
      eventName: event,
    }

    const nonSerializable = validateSerializable(payload, context)
    if (nonSerializable) throw nonSerializable

    const validated = validateAgainstContract(schema, payload, context)
    if (!validated.ok) throw validated.error

    deliver(event, validated.value)
  }
}
