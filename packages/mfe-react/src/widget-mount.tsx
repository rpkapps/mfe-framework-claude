/**
 * The Widget provider boundary: an accepted input update publishes a snapshot to the existing
 * mount rather than remounting it, and the host's channel lives in a ref so the Widget never
 * re-renders because its host handed over a new one.
 */

import {
  createMfeError,
  validateAgainstContract,
  validateSerializable,
  type MfeError,
} from '@company/mfe-core'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { assertUsableInputNames, type WidgetDefinition } from './definition.ts'
import type { MfeMount } from './runtime.ts'

/** Shallow comparison over input names, so a handler change is not an input change. */
function inputsEqual(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key)) return false
    if (!Object.is(a[key], b[key])) return false
  }
  return true
}

export interface WidgetMountProps {
  readonly definition: WidgetDefinition
  readonly mount: MfeMount
  readonly inputs: Readonly<Record<string, unknown>>
  /** The host's channel, called with a payload this Widget's own event schema accepted. */
  readonly emit: (event: string, payload: unknown) => void
  readonly onInputRejected?: ((error: MfeError) => void) | undefined
}

interface ValidationState {
  /** The input set the result below belongs to. */
  readonly checked: Readonly<Record<string, unknown>>
  /** The last inputs that passed; a rejected update deliberately leaves it alone. */
  readonly valid: Record<string, unknown> | null
  readonly error: MfeError | null
}

/** Pure, so it is safe to call during render. */
function validateInto(
  definition: WidgetDefinition,
  inputs: Readonly<Record<string, unknown>>,
  previousValid: Record<string, unknown> | null,
): ValidationState {
  const context = {
    id: definition.id,
    ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
    direction: 'input' as const,
    side: 'provider' as const,
  }

  const nonSerializable = validateSerializable(inputs, context)
  if (nonSerializable) return { checked: inputs, valid: previousValid, error: nonSerializable }

  const result = validateAgainstContract(definition.contract.inputs, inputs, {
    ...context,
  })
  if (!result.ok) return { checked: inputs, valid: previousValid, error: result.error }

  const value = result.value as Record<string, unknown>
  assertUsableInputNames(definition.id, Object.keys(value))
  return { checked: inputs, valid: value, error: null }
}

/** Memoized on the validated inputs, so a channel-only change re-renders nothing remote. */
const WidgetBody = memo(function RenderWidgetBody({
  definition,
  inputs,
  emit,
}: {
  readonly definition: WidgetDefinition
  readonly inputs: Record<string, unknown>
  readonly emit: (event: string, payload: unknown) => void
}): ReactNode {
  const Render = definition.render as (props: {
    inputs: unknown
    emit: (event: string, payload: unknown) => void
  }) => ReactNode

  return <Render inputs={inputs} emit={emit} />
})

export function WidgetMount({
  definition,
  mount,
  inputs,
  emit: hostEmit,
  onInputRejected,
}: WidgetMountProps): ReactNode {
  const { diagnostics } = mount.runtime

  // Assigning during render would publish a channel from a render React may abandon.
  const committedEmit = useRef(hostEmit)
  useEffect(() => {
    committedEmit.current = hostEmit
  })

  // React state rather than a ref, because a ref written during a render React discards would
  // describe inputs that were never committed.
  const [validation, setValidation] = useState(() => validateInto(definition, inputs, null))

  if (!Object.is(validation.checked, inputs) && !inputsEqual(validation.checked, inputs)) {
    setValidation(current => validateInto(definition, inputs, current.valid))
  }

  // Reporting is a side effect: an abandoned render must not reach the sink.
  const reported = useRef<MfeError | null>(null)
  useEffect(() => {
    const { error } = validation
    if (error === null || reported.current === error) return

    reported.current = error
    diagnostics.report(error, { context: { widget: definition.id } })
    onInputRejected?.(error)
  }, [validation, diagnostics, definition.id, onInputRejected])

  const emit = useMemo(() => {
    const declared = definition.contract.events
    const version =
      definition.version === undefined ? {} : { definitionVersion: definition.version }

    return (event: string, payload: unknown): void => {
      const schema = declared[event]
      if (!schema) {
        // Throwing at the call site keeps the failure in the provider's own stack.
        throw createMfeError({
          code: 'contract/event-mismatch',
          id: definition.id,
          ...version,
          operation: `emit event '${event}'`,
          direction: 'event',
          expected: `one of the declared events (${Object.keys(declared).join(', ') || 'none'})`,
          observed: `'${event}', which this Widget does not declare`,
          repair: `Add '${event}' to the events schema, or emit a declared event.`,
        })
      }

      const providerContext = {
        id: definition.id,
        ...version,
        direction: 'event' as const,
        side: 'provider' as const,
        eventName: event,
      }

      const nonSerializable = validateSerializable(payload, providerContext)
      if (nonSerializable) throw nonSerializable

      const validated = validateAgainstContract(schema, payload, providerContext)
      if (!validated.ok) throw validated.error

      // Whatever the consumer declared is the host's to check, on its side of the channel.
      committedEmit.current(event, validated.value)
    }
  }, [definition])

  const validInputs = validation.valid
  if (validInputs === null) {
    // Nothing to fall back to on the first mount, so the validation error itself is thrown.
    if (validation.error !== null) throw validation.error

    throw createMfeError({
      code: 'contract/input-mismatch',
      id: definition.id,
      operation: 'accept input',
      direction: 'input',
      expected: 'inputs matching the declared schema',
      observed: 'none that passed validation',
      repair: 'Correct the props passed to this Widget, then use the retry action.',
    })
  }

  return <WidgetBody definition={definition} inputs={validInputs} emit={emit} />
}
