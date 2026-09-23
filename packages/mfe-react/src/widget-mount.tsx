/**
 * The Widget provider boundary: an accepted input update publishes a snapshot to the existing
 * mount rather than remounting it, and the host's channel lives in a ref so the Widget never
 * re-renders because its host handed over a new one.
 */

import { createMfeError, shallowEqual, type MfeError } from '@company/mfe-core'
import { createProviderEmit, validateProviderInputs } from '@company/mfe-runtime'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { WidgetDefinition } from './definition.ts'
import type { MfeMount } from './runtime.ts'

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

/**
 * Pure, so it is safe to call during render. A reserved input name is thrown rather than kept:
 * no later set can repair the contract, so failing the render fails the mount, or reaches the
 * host through `onFailure` once it is mounted.
 */
function validateInto(
  definition: WidgetDefinition,
  inputs: Readonly<Record<string, unknown>>,
  previousValid: Record<string, unknown> | null,
): ValidationState {
  const result = validateProviderInputs(definition, inputs)
  if (result.status === 'misdeclared') throw result.error
  if (result.status === 'rejected') {
    return { checked: inputs, valid: previousValid, error: result.error }
  }
  return { checked: inputs, valid: result.value as Record<string, unknown>, error: null }
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

  // Shallow over input names, so a handler change is not an input change.
  if (!shallowEqual(validation.checked, inputs)) {
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

  const emit = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- `createProviderEmit` only keeps the callback, which reads the ref when the Widget emits and never while this renders
      createProviderEmit(definition, (event, payload) => {
        committedEmit.current(event, payload)
      }),
    [definition],
  )

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
