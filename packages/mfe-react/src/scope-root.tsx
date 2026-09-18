/**
 * Scope and overlay roots.
 *
 * Every mount renders inside a `data-mfe-scope` element, and the build emits
 * its CSS as `@scope ([data-mfe-scope="<id>"]) to ([data-mfe-scope])`: the lower
 * boundary stops a parent App's rules matching inside a nested App's root, and
 * `@scope` does not block inheritance, so shell theme values still flow down.
 * Overlays portalled to the body get a second root, or they escape the scope.
 */

import type { ReactNode } from 'react'

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
  readonly children: ReactNode
}

export function MfeScopeRoot({
  definitionId,
  mountToken,
  kind,
  children,
}: ScopeRootProps): ReactNode {
  return (
    <div
      {...{ [SCOPE_ATTRIBUTE]: definitionId, [MOUNT_ATTRIBUTE]: mountToken }}
      data-mfe-kind={kind}
    >
      {children}
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
