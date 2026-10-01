/**
 * The Widget provider boundary: an accepted input update publishes a snapshot to the existing
 * mount rather than remounting it, and the host's channel lives in a ref so the Widget never
 * re-renders because its host handed over a new one.
 */

import { createProviderEmit } from '@company/mfe-runtime'
import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react'

import type { WidgetDefinition } from './definition.ts'

export interface WidgetMountProps {
  readonly definition: WidgetDefinition
  /** Inputs the provider already parsed before scheduling this render. */
  readonly inputs: unknown
  /** The host's channel, called with a payload this Widget's own output schema accepted. */
  readonly emit: (output: string, payload: unknown) => void
}

/** Memoized on the validated inputs, so a channel-only change re-renders nothing remote. */
const WidgetBody = memo(function RenderWidgetBody({
  definition,
  inputs,
  emit,
}: {
  readonly definition: WidgetDefinition
  readonly inputs: unknown
  readonly emit: (output: string, payload: unknown) => void
}): ReactNode {
  const Render = definition.render as (props: {
    inputs: unknown
    emit: (output: string, payload: unknown) => void
  }) => ReactNode

  return <Render inputs={inputs} emit={emit} />
})

export function WidgetMount({ definition, inputs, emit: hostEmit }: WidgetMountProps): ReactNode {
  // Assigning during render would publish a channel from a render React may abandon.
  const committedEmit = useRef(hostEmit)
  useEffect(() => {
    committedEmit.current = hostEmit
  })

  const emit = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- `createProviderEmit` only keeps the callback, which reads the ref when the Widget emits and never while this renders
      createProviderEmit(definition, (output, payload) => {
        committedEmit.current(output, payload)
      }),
    [definition],
  )

  return <WidgetBody definition={definition} inputs={inputs} emit={emit} />
}
