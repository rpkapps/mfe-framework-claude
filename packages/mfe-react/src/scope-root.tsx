/**
 * Every mount renders inside a `data-mfe-scope` element the container's stylesheet is scoped
 * to, with a second root carrying the same attribute for body-level overlays (§17). The scope
 * root is `display: contents`, so it anchors a selector without becoming a box in the layout.
 */

import { KIND_ATTRIBUTE, MOUNT_ATTRIBUTE, SCOPE_ATTRIBUTE } from '@company/mfe-host'
import type { ReactNode } from 'react'

import type { MfeStyleRoot } from './style-root.ts'

/** Defined by the host, so an adapter without React builds the same roots this one renders. */
export {
  createOverlayRoot,
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
} from '@company/mfe-host'

export interface ScopeRootProps {
  readonly definitionId: string
  readonly mountToken: string
  readonly kind: 'app' | 'widget'
  /** This mount's body-level overlay root, handed to the style root. */
  readonly overlayRoot: HTMLElement
  /** Renders inside the scope root rather than around it, so the scope element stays ours. */
  readonly styleRoot?: MfeStyleRoot | undefined
  readonly children: ReactNode
}

/** Inline rather than a class, because the framework ships no stylesheet. */
const LAYOUT_NEUTRAL = { display: 'contents' } as const

export function MfeScopeRoot({
  definitionId,
  mountToken,
  kind,
  overlayRoot,
  styleRoot: StyleRoot,
  children,
}: ScopeRootProps): ReactNode {
  return (
    <div
      {...{
        [SCOPE_ATTRIBUTE]: definitionId,
        [MOUNT_ATTRIBUTE]: mountToken,
        [KIND_ATTRIBUTE]: kind,
      }}
      style={LAYOUT_NEUTRAL}
    >
      {StyleRoot === undefined ? (
        children
      ) : (
        <StyleRoot overlayContainer={overlayRoot}>{children}</StyleRoot>
      )}
    </div>
  )
}
