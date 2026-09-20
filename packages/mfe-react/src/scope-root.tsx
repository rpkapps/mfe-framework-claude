/**
 * Scope and overlay roots.
 *
 * Every mount renders inside a `data-mfe-scope` element whose CSS the build
 * emits as `@scope ([data-mfe-scope="<id>"], …) to ([data-mfe-scope])`, and
 * overlays portalled to the body get a second root carrying the same attribute,
 * or they would escape that scope. The scope root is a selector anchor, never a
 * box: `display: contents` keeps it out of layout, so the element the App or
 * Widget renders is the direct child of whatever the host laid out — without
 * it, a mount is a block that shrinks to its content inside a flex parent, with
 * `h-full` resolving against nothing. `@scope` matches on the DOM tree rather
 * than on boxes, so the boundary is unaffected.
 */

import type { ReactNode } from 'react'

import type { MfeStyleRoot } from './style-root.ts'

/** Reserved for App, Widget and framework portal roots. */
export const SCOPE_ATTRIBUTE = 'data-mfe-scope'

/**
 * Internal mount discriminator, so two mounts of the same definition get
 * distinct DOM roots. The scope value stays the public id, because that is what
 * the generated CSS selector matches.
 */
const MOUNT_ATTRIBUTE = 'data-mfe-mount'

export interface ScopeRootProps {
  readonly definitionId: string
  readonly mountToken: string
  readonly kind: 'app' | 'widget'
  /** This mount's body-level overlay root, handed to the style root. */
  readonly overlayRoot: HTMLElement
  /**
   * The component the container's own build attached to the definition, when it
   * ships CSS that needs one. It renders inside the scope root rather than
   * around it, so the scope element stays the framework's own anchor.
   */
  readonly styleRoot?: MfeStyleRoot | undefined
  readonly children: ReactNode
}

/**
 * Inline rather than a class: the framework ships no stylesheet, and a class
 * would only work for hosts that happened to load one.
 */
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
      {...{ [SCOPE_ATTRIBUTE]: definitionId, [MOUNT_ATTRIBUTE]: mountToken }}
      data-mfe-kind={kind}
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

/**
 * The caller owns the disposer so overlay cleanup runs on the same teardown path
 * as everything else the mount owns.
 */
export function createOverlayRoot(
  definitionId: string,
  mountToken: string,
  document: Document,
): { readonly element: HTMLElement; readonly dispose: () => void } {
  const element = document.createElement('div')
  element.setAttribute(SCOPE_ATTRIBUTE, definitionId)
  element.setAttribute(MOUNT_ATTRIBUTE, mountToken)
  element.setAttribute('data-mfe-overlay-root', '')
  document.body.appendChild(element)

  return {
    element,
    dispose: () => {
      element.remove()
    },
  }
}
