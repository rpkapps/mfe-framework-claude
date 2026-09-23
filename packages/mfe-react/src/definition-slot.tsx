/**
 * What every React host renders where a definition goes: the empty element the definition mounts
 * itself into, kept for the mount's whole life so a retry mounts into the same place, and beside
 * it whatever the host shows while the mount is pending or after it failed.
 */

import type { MfeError, MountState } from '@company/mfe-core'
import type { ReactNode, RefObject } from 'react'

/** Inline rather than a class, because the framework ships no stylesheet. */
const LAYOUT_NEUTRAL = { display: 'contents' } as const

export interface DefinitionSlotProps {
  /** The element the definition mounts itself into. */
  readonly element: RefObject<HTMLDivElement | null>
  readonly state: MountState
  readonly retry: () => void
  readonly pending?: ReactNode
  /** Without one, a failure is thrown for the nearest error boundary, as any render error is. */
  readonly fallback?:
    ((props: { readonly error: MfeError; readonly retry: () => void }) => ReactNode) | undefined
}

export function DefinitionSlot({
  element,
  state,
  retry,
  pending,
  fallback,
}: DefinitionSlotProps): ReactNode {
  if (state.status === 'error' && fallback === undefined) throw state.error

  return (
    <>
      {state.status === 'pending' ? pending : null}
      {state.status === 'error' && fallback !== undefined
        ? fallback({ error: state.error, retry })
        : null}
      <div ref={element} style={LAYOUT_NEUTRAL} />
    </>
  )
}
