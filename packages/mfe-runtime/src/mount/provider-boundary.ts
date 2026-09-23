/**
 * The provider's half of the Widget boundary, which every adapter's `mount` applies to its own
 * Widget: the inputs a host passes and every payload the Widget emits are checked against the
 * Widget's own contract, so a failure here is always the provider's to fix. The host checks only
 * what it declared itself, in `mountDefinition`.
 */

import {
  createMfeError,
  isRecord,
  isReservedInputName,
  validateAgainstContract,
  validateSerializable,
  withoutUndefined,
  type ContractValidationContext,
  type MfeError,
} from '@company/mfe-core'

import type { MountableWidgetDefinition } from './mountable-definition.ts'

/** What the checks read from a Widget definition, whichever adapter built it. */
export type ProviderDefinition = Pick<MountableWidgetDefinition, 'id' | 'version' | 'contract'>

/** What the Widget's own contract made of one set of inputs. */
export type ProviderInputs =
  /** `value` is what the inputs schema produced. */
  | { readonly status: 'accepted'; readonly value: unknown }
  /** This set breaks the contract: a mount keeps its last valid set, and a first mount fails. */
  | { readonly status: 'rejected'; readonly error: MfeError }
  /**
   * The contract produced an input name a host reserves for its own props. The declaration is at
   * fault rather than the set, so the mount fails, on its first set or on a later one.
   */
  | { readonly status: 'misdeclared'; readonly error: MfeError }

function contextOf(
  definition: ProviderDefinition,
  direction: 'input' | 'event',
  eventName?: string,
): ContractValidationContext {
  return {
    id: definition.id,
    ...withoutUndefined({ definitionVersion: definition.version, eventName }),
    direction,
    side: 'provider',
  }
}

function reservedInputName(id: string, name: string): MfeError {
  return createMfeError({
    code: 'contract/input-mismatch',
    id,
    operation: `declare input '${name}'`,
    expected: 'an input name that is not reserved for host control or event handlers',
    observed: `'${name}', which is reserved`,
    repair: 'Rename the input; key, ref, fallback and onX names belong to the host.',
  })
}

/**
 * Serializability first, so the diagnostic names the real problem, then the schema, then the
 * names the schema produced. Pure, so a host's render may call it.
 */
export function validateProviderInputs(
  definition: ProviderDefinition,
  inputs: Readonly<Record<string, unknown>>,
): ProviderInputs {
  const context = contextOf(definition, 'input')

  const nonSerializable = validateSerializable(inputs, context)
  if (nonSerializable) return { status: 'rejected', error: nonSerializable }

  const result = validateAgainstContract(definition.contract.inputs, inputs, context)
  if (!result.ok) return { status: 'rejected', error: result.error }

  const reserved = isRecord(result.value)
    ? Object.keys(result.value).find(isReservedInputName)
    : undefined
  if (reserved !== undefined) {
    return { status: 'misdeclared', error: reservedInputName(definition.id, reserved) }
  }

  return { status: 'accepted', value: result.value }
}

/**
 * The one emit a Widget's events go through. It throws at the call site, which keeps a failure in
 * the provider's own stack; `deliver` receives only a payload the Widget's own schema accepted.
 */
export function createProviderEmit(
  definition: ProviderDefinition,
  deliver: (event: string, payload: unknown) => void,
): (event: string, payload: unknown) => void {
  const declared = definition.contract.events

  return (event, payload) => {
    const schema = declared[event]
    if (!schema) {
      throw createMfeError({
        code: 'contract/event-mismatch',
        id: definition.id,
        ...withoutUndefined({ definitionVersion: definition.version }),
        operation: `emit event '${event}'`,
        direction: 'event',
        expected: `one of the declared events (${Object.keys(declared).join(', ') || 'none'})`,
        observed: `'${event}', which this Widget does not declare`,
        repair: `Add '${event}' to the events schema, or emit a declared event.`,
      })
    }

    const context = contextOf(definition, 'event', event)

    const nonSerializable = validateSerializable(payload, context)
    if (nonSerializable) throw nonSerializable

    const validated = validateAgainstContract(schema, payload, context)
    if (!validated.ok) throw validated.error

    // Whatever the consumer declared is the host's to check, on its side of the channel.
    deliver(event, validated.value)
  }
}
