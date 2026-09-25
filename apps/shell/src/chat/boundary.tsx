/**
 * What keeps a part of the conversation that throws as it renders from taking the panel with it.
 * The conversation lives outside React, so rendering it again throws again: the part says it could
 * not be shown and the rest of the chat carries on, where the panel's load boundary would have
 * said the assistant could not be loaded and a retry would have thrown once more.
 */

import { Component, type ReactNode } from 'react'
import { Marker, MarkerContent, MarkerIcon } from '@tecton/react/components/marker'
import { TriangleAlertIcon } from 'lucide-react'

interface RenderBoundaryProps {
  /** What shows instead of `children` once they have thrown. */
  readonly fallback: ReactNode
  /** Tries `children` again when it changes: a part that moved on may render now. */
  readonly resetKey?: unknown
  readonly children: ReactNode
}

interface RenderBoundaryState {
  readonly failed: boolean
  readonly resetKey: unknown
}

export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  override state: RenderBoundaryState = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<RenderBoundaryState> {
    return { failed: true }
  }

  static getDerivedStateFromProps(
    props: RenderBoundaryProps,
    state: RenderBoundaryState,
  ): Partial<RenderBoundaryState> | null {
    return Object.is(props.resetKey, state.resetKey)
      ? null
      : { failed: false, resetKey: props.resetKey }
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Said in place of a part of the transcript that could not be drawn. */
export function NotShown({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <Marker data-slot="chat-not-shown" className="text-xs">
      <MarkerIcon>
        <TriangleAlertIcon className="size-3.5" />
      </MarkerIcon>
      <MarkerContent>{children}</MarkerContent>
    </Marker>
  )
}

/** One part of a message, which says it could not be shown if it throws. */
export function PartBoundary({
  resetKey,
  children,
}: {
  readonly resetKey?: unknown
  readonly children: ReactNode
}): ReactNode {
  return (
    <RenderBoundary
      resetKey={resetKey}
      fallback={<NotShown>This part of the reply could not be shown.</NotShown>}
    >
      {children}
    </RenderBoundary>
  )
}
