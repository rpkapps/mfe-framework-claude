/**
 * The Widget provider boundary: input validation, event emission and the remote
 * render.
 *
 * Inputs are reactive but not cheap to validate, so they are compared shallowly
 * first and a successful update publishes a validated snapshot to the existing
 * mount rather than remounting it. Handlers change on almost every render, so
 * they live in a ref and the channel is never torn down and rebuilt.
 */

import {
  createMfeError,
  validateAgainstContract,
  validateSerializable,
  type MfeError,
  type WidgetContract,
} from '@company/mfe-core'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { z } from 'zod'

import { assertUsableInputNames, type WidgetDefinition } from './definition.ts'
import { MfeMountProvider } from './mount-context.tsx'
import { MfeScopeRoot } from './scope-root.tsx'
import type { MfeMount } from './runtime.ts'

export type WidgetEventHandlers = Readonly<Record<string, (payload: unknown) => void>>

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
  /** Latest committed handlers, keyed by event name (not by `onX` prop name). */
  readonly handlers: WidgetEventHandlers
  /** Consumer-declared event schemas, when a runtime contract was supplied. */
  readonly consumerEvents?: Readonly<Record<string, z.ZodType>> | undefined
  readonly onInputRejected?: (error: MfeError) => void
}

interface ValidationState {
  /** The input set the result below belongs to. */
  readonly checked: Readonly<Record<string, unknown>>
  /** The last inputs that passed; a rejected update deliberately leaves it alone. */
  readonly valid: Record<string, unknown> | null
  readonly error: MfeError | null
}

/**
 * Pure, so it is safe to call during render: it allocates a new state value and
 * touches nothing outside.
 */
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
    note: 'The previous valid inputs remain displayed.',
  })
  if (!result.ok) return { checked: inputs, valid: previousValid, error: result.error }

  const value = result.value as Record<string, unknown>
  assertUsableInputNames(definition.id, Object.keys(value))
  return { checked: inputs, valid: value, error: null }
}

/**
 * Memoized on the validated inputs, so a handler-only change re-renders nothing
 * remote: the handler ref is updated outside React's data flow.
 */
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
  handlers,
  consumerEvents,
  onInputRejected,
}: WidgetMountProps): ReactNode {
  const { diagnostics } = mount.runtime

  // Assigning during render would publish callbacks from a render React may
  // still abandon, so the ref is updated in an effect instead.
  const committedHandlers = useRef(handlers)
  useEffect(() => {
    committedHandlers.current = handlers
  })

  // Validation state is React state, not a ref, and the comparison happens
  // during render using React's documented "adjust state when props change"
  // pattern. Writing refs during render would be wrong here: React may discard a
  // render, and under concurrent rendering the ref could then describe inputs
  // that were never committed.
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
        // Throwing at the call site keeps the failure in the provider's own
        // stack rather than surfacing at a distant consumer.
        throw createMfeError({
          code: 'contract/event-mismatch',
          id: definition.id,
          ...version,
          operation: `emit event '${event}'`,
          direction: 'event',
          expected: `one of the declared events (${Object.keys(declared).join(', ') || 'none'})`,
          observed: `'${event}', which this Widget does not declare`,
          declaredBy: 'The Widget contract',
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

      // The consumer validates again only when it supplied a runtime contract.
      // Without one it has no schema to check against, which is why
      // contract-free consumption is documented as the weaker mode.
      const consumerSchema = consumerEvents?.[event]
      if (!consumerSchema) {
        committedHandlers.current[event]?.(validated.value)
        return
      }

      const accepted = validateAgainstContract(consumerSchema, validated.value, {
        ...providerContext,
        side: 'consumer',
        note: 'The event was dropped and the handler was not called. The Widget mount is unaffected.',
      })
      if (!accepted.ok) {
        diagnostics.report(accepted.error, { context: { widget: definition.id, event } })
        return
      }

      committedHandlers.current[event]?.(accepted.value)
    }
  }, [definition, consumerEvents, diagnostics])

  const validInputs = validation.valid
  if (validInputs === null) {
    // Nothing to fall back to on the very first mount, so the mount fails with
    // the validation error itself: it names the field, the value and the repair.
    if (validation.error !== null) throw validation.error

    throw createMfeError({
      code: 'contract/input-mismatch',
      id: definition.id,
      operation: 'accept input',
      direction: 'input',
      expected: 'inputs matching the declared schema',
      observed: 'none that passed validation',
      declaredBy: 'The Widget provider',
      repair: 'Correct the props passed to this Widget, then use the retry action.',
    })
  }

  return (
    <MfeMountProvider mount={mount}>
      <MfeScopeRoot definitionId={definition.id} mountToken={mount.mountToken} kind="widget">
        <WidgetBody definition={definition} inputs={validInputs} emit={emit} />
      </MfeScopeRoot>
    </MfeMountProvider>
  )
}

/** Splits consumer props into inputs, event handlers and host control props. */
export function partitionWidgetProps(
  props: Readonly<Record<string, unknown>>,
  declaredEvents: readonly string[],
): {
  readonly inputs: Record<string, unknown>
  readonly handlers: Record<string, (payload: unknown) => void>
} {
  const inputs: Record<string, unknown> = {}
  const handlers: Record<string, (payload: unknown) => void> = {}

  const handlerPropToEvent = new Map(
    declaredEvents.map(event => [`on${event.charAt(0).toUpperCase()}${event.slice(1)}`, event]),
  )

  for (const [name, value] of Object.entries(props)) {
    // Reserved control props are never forwarded as inputs.
    if (name === 'fallback' || name === 'key' || name === 'ref') continue

    const event = handlerPropToEvent.get(name)
    if (event !== undefined) {
      if (typeof value === 'function') handlers[event] = value as (payload: unknown) => void
      continue
    }

    // An `onX` prop with no matching event is not silently treated as an input:
    // it would fail serializability validation with a confusing message.
    if (/^on[A-Z]/.test(name)) continue

    inputs[name] = value
  }

  return { inputs, handlers }
}

/** A contract's declared event names, or an empty list for contract-free use. */
export function declaredEventNames(contract: WidgetContract | undefined): readonly string[] {
  return contract ? Object.keys(contract.events) : []
}
