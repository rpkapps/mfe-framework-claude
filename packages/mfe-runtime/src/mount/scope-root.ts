/**
 * Every mount renders inside a `data-mfe-scope` element the container's stylesheet is scoped to,
 * with a second root carrying the same attribute for body-level overlays. Both are plain DOM the
 * runtime creates for each mount, so no adapter builds a root of its own.
 */

import type { DefinitionKind } from '@company/mfe-core'

/** Reserved for App, Widget and framework portal roots. */
export const SCOPE_ATTRIBUTE = 'data-mfe-scope'

/** Distinguishes two mounts of one definition; the scope value stays the id the CSS matches. */
export const MOUNT_ATTRIBUTE = 'data-mfe-mount'

/** Which kind of definition a mount root belongs to, for a tool reading the page rather than the registry. */
export const KIND_ATTRIBUTE = 'data-mfe-kind'

/** Marks the body-level root, which carries the same scope and mount but is not where the definition renders. */
export const OVERLAY_ROOT_ATTRIBUTE = 'data-mfe-overlay-root'

export interface ScopeAttributes {
  readonly definitionId: string
  readonly mountToken: string
  readonly kind: DefinitionKind
}

/**
 * Turns `element` into a mount's scope root. `display: contents` is part of it, inline because the
 * framework ships no stylesheet: the root anchors a selector without becoming a box in the layout.
 */
export function applyScopeAttributes(
  element: HTMLElement,
  { definitionId, mountToken, kind }: ScopeAttributes,
): void {
  element.setAttribute(SCOPE_ATTRIBUTE, definitionId)
  element.setAttribute(MOUNT_ATTRIBUTE, mountToken)
  element.setAttribute(KIND_ATTRIBUTE, kind)
  element.style.display = 'contents'
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
