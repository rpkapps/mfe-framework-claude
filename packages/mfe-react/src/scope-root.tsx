/**
 * Scope and overlay roots.
 *
 * Every App and Widget mount renders inside an element carrying
 * `data-mfe-scope`, and the build emits its CSS as
 * `@scope ([data-mfe-scope="<id>"]) to ([data-mfe-scope])`. The lower boundary
 * is what stops a parent App's rules matching inside a nested App's root, and
 * `@scope` does not block inheritance, so shell fonts, theme values and CSS
 * variables still flow down.
 *
 * Overlays need a second root: content portalled to the body would otherwise
 * escape the scope entirely. The framework creates one body-level root per
 * mount, carrying the same scope attribute, and hands it to the design
 * system's portal provider. Authors never pass portal targets.
 */

import { useEffect, useMemo, type ReactNode } from 'react'

/** Reserved for App, Widget and framework portal roots. */
export const SCOPE_ATTRIBUTE = 'data-mfe-scope'

/**
 * Internal mount discriminator, so two mounts of the same definition get
 * distinct DOM roots. The semantic scope value stays the public id, because
 * that is what the generated CSS selector matches.
 */
export const MOUNT_ATTRIBUTE = 'data-mfe-mount'

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
 * Creates the body-level overlay root for a mount.
 *
 * Returns the element and a disposer. The caller owns the disposer so overlay
 * cleanup runs on the same teardown path as everything else the mount owns,
 * rather than in a separate effect that could be skipped.
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

/**
 * Creates an overlay root bound to a React component's lifetime.
 *
 * Used where the adapter renders a mount as ordinary React rather than owning
 * an imperative root.
 */
export function useOverlayRoot(definitionId: string, mountToken: string): HTMLElement {
  const root = useMemo(
    () => createOverlayRoot(definitionId, mountToken, document),
    [definitionId, mountToken],
  )

  useEffect(() => root.dispose, [root])

  return root.element
}
