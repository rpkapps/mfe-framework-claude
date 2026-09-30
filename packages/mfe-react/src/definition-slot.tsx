/**
 * What every React host renders where a definition goes: the empty element the definition mounts
 * itself into, kept for the mount's whole life so a retry mounts into the same place, and beside
 * it whatever the host shows while the mount is pending or after it failed.
 */

import type { MfeError, MountState } from '@company/mfe-core'
import {
  definitionRecovery,
  definitionRecoveryMessage,
  type WidgetInputState,
} from '@company/mfe-runtime'
import type { ReactNode, RefObject } from 'react'

/** Inline rather than a class, because the framework ships no stylesheet. */
const LAYOUT_NEUTRAL = { display: 'contents' } as const

export interface DefinitionSlotProps {
  /** The element the definition mounts itself into. */
  readonly element: RefObject<HTMLDivElement | null>
  readonly state: MountState
  readonly attempt?: number
  readonly inputState?: WidgetInputState
  readonly retry: () => void
  readonly reload: () => void
  readonly pending?: ReactNode
  /** Replaces the default local error surface. */
  readonly fallback?:
    | ((props: {
        readonly error: MfeError
        readonly retry: () => void
        readonly reload: () => void
      }) => ReactNode)
    | undefined
  readonly inputFallback?: ((props: { readonly error: MfeError }) => ReactNode) | undefined
}

export function DefinitionSlot({
  element,
  state,
  attempt = 0,
  inputState,
  retry,
  reload,
  pending,
  fallback,
  inputFallback,
}: DefinitionSlotProps): ReactNode {
  return (
    <>
      {state.status === 'pending' ? (
        pending === undefined ? (
          <p role="status">Loading feature…</p>
        ) : (
          pending
        )
      ) : null}
      {state.status === 'error' ? (
        fallback === undefined ? (
          <div role="alert" data-mfe-error={state.error.code}>
            <p>{definitionRecoveryMessage(definitionRecovery(state.error))}</p>
            <details>
              <summary>Details</summary>
              <p>{state.error.message}</p>
              <p>
                {state.error.code} · {state.error.id}
                {state.error.definitionVersion === undefined
                  ? ''
                  : `@${state.error.definitionVersion}`}
                {' · '}
                {state.error.operation} · attempt {attempt}
              </p>
            </details>
            {definitionRecovery(state.error) === 'retry' ||
            definitionRecovery(state.error) === 'correct-inputs' ? (
              <button type="button" onClick={retry}>
                Retry
              </button>
            ) : (
              <button type="button" onClick={reload}>
                Reload page
              </button>
            )}
          </div>
        ) : (
          fallback({ error: state.error, retry, reload })
        )
      ) : null}
      {state.status === 'mounted' && inputState?.status === 'rejected' ? (
        inputFallback === undefined ? (
          <p role="status" data-mfe-input-rejected="">
            This widget is showing its previous inputs because the latest update was rejected.
          </p>
        ) : (
          inputFallback({ error: inputState.error })
        )
      ) : null}
      <div ref={element} style={LAYOUT_NEUTRAL} />
    </>
  )
}
