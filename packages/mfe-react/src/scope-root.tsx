/**
 * Every mount renders inside a `data-mfe-scope` element the container's stylesheet is scoped
 * to, with a second root carrying the same attribute for body-level overlays (§17). The scope
 * root is `display: contents`, so it anchors a selector without becoming a box in the layout.
 */

import type { ReactNode } from 'react'

import type { MfeStyleRoot } from './style-root.ts'

/** Reserved for App, Widget and framework portal roots. */
export const SCOPE_ATTRIBUTE = 'data-mfe-scope'

/** Distinguishes two mounts of one definition; the scope value stays the id the CSS matches. */
export const MOUNT_ATTRIBUTE = 'data-mfe-mount'

/** Which kind of definition a mount root belongs to, for a tool reading the page rather than the registry. */
export const KIND_ATTRIBUTE = 'data-mfe-kind'

/** Marks the body-level root, which carries the same scope and mount but is not where the definition renders. */
export const OVERLAY_ROOT_ATTRIBUTE = 'data-mfe-overlay-root'

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

/** The caller owns the disposer, so cleanup runs on the mount's own teardown path. */
export function createOverlayRoot(
  definitionId: string,
  mountToken: string,
  document: Document,
): { readonly element: HTMLElement; readonly dispose: () => void } {
  const element = document.createElement('div')
  element.setAttribute(SCOPE_ATTRIBUTE, definitionId)
  element.setAttribute(MOUNT_ATTRIBUTE, mountToken)
  element.setAttribute(OVERLAY_ROOT_ATTRIBUTE, '')
  document.body.appendChild(element)

  return {
    element,
    dispose: () => {
      element.remove()
    },
  }
}
