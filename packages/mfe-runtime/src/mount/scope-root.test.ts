/**
 * An adapter with no React builds its scope root from these, so what they set is exactly what a
 * container's scoped stylesheet and the developer tools read off the page.
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyScopeAttributes,
  createOverlayRoot,
  KIND_ATTRIBUTE,
  MOUNT_ATTRIBUTE,
  OVERLAY_ROOT_ATTRIBUTE,
  SCOPE_ATTRIBUTE,
} from './scope-root.ts'

afterEach(() => {
  document.body.replaceChildren()
})

describe('applyScopeAttributes', () => {
  it('marks the element with the definition, the mount and the kind', () => {
    const element = document.createElement('div')

    applyScopeAttributes(element, {
      definitionId: 'alert-panel',
      mountToken: 'alert-panel#3',
      kind: 'widget',
    })

    expect(element.getAttribute(SCOPE_ATTRIBUTE)).toBe('alert-panel')
    expect(element.getAttribute(MOUNT_ATTRIBUTE)).toBe('alert-panel#3')
    expect(element.getAttribute(KIND_ATTRIBUTE)).toBe('widget')
  })

  /** The root anchors a selector; a box of its own would change the host's layout. */
  it('keeps the element out of the layout', () => {
    const element = document.createElement('div')

    applyScopeAttributes(element, { definitionId: 'reports', mountToken: 'reports#1', kind: 'app' })

    expect(element.style.display).toBe('contents')
  })

  it('never marks the element as an overlay root', () => {
    const element = document.createElement('div')

    applyScopeAttributes(element, { definitionId: 'reports', mountToken: 'reports#1', kind: 'app' })

    expect(element.hasAttribute(OVERLAY_ROOT_ATTRIBUTE)).toBe(false)
  })
})

describe('createOverlayRoot', () => {
  it('appends a body-level root carrying the scope and the mount', () => {
    const overlay = createOverlayRoot('alert-panel', 'alert-panel#4', document)

    expect(overlay.element.parentElement).toBe(document.body)
    expect(overlay.element.getAttribute(SCOPE_ATTRIBUTE)).toBe('alert-panel')
    expect(overlay.element.getAttribute(MOUNT_ATTRIBUTE)).toBe('alert-panel#4')
    expect(overlay.element.hasAttribute(OVERLAY_ROOT_ATTRIBUTE)).toBe(true)
  })

  it('carries no kind, because it is not where the definition renders', () => {
    const overlay = createOverlayRoot('alert-panel', 'alert-panel#5', document)

    expect(overlay.element.hasAttribute(KIND_ATTRIBUTE)).toBe(false)
  })

  it('removes only its own root when disposed', () => {
    const first = createOverlayRoot('alert-panel', 'alert-panel#6', document)
    const second = createOverlayRoot('alert-panel', 'alert-panel#7', document)

    first.dispose()

    expect(first.element.isConnected).toBe(false)
    expect(second.element.isConnected).toBe(true)
    expect(document.body.children).toHaveLength(1)
  })
})
