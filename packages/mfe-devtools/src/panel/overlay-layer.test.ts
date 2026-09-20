/**
 * The one node this package adds to a document it does not own.
 *
 * Asserted against `document.body` rather than through a render query,
 * because what is on trial is a side effect rather than a tree — and the
 * failure worth catching is the node that stops being removed, which no
 * screen query would notice.
 *
 * The hook is tested rather than the panel: React Aria's `Toolbar` reads an
 * inherited property off `<html>`, and this jsdom throws resolving one there,
 * so the header cannot be rendered in this environment at all. That is a
 * reason to keep the side effect out of the component, not a reason to leave
 * it unasserted.
 */

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useOverlayLayer } from './overlay-layer.ts'

const layers = (): NodeListOf<Element> => document.querySelectorAll('[data-mfe-devtools-overlays]')

afterEach(() => {
  for (const node of layers()) node.remove()
})

describe('the overlay layer', () => {
  it('is not in the document until something asks for it', () => {
    expect(layers()).toHaveLength(0)
  })

  it('appends one node to the body and hands back a getter for it', () => {
    const { result } = renderHook(() => useOverlayLayer())

    expect(layers()).toHaveLength(1)
    expect(result.current()).toBe(layers()[0])
    expect(result.current()?.parentElement).toBe(document.body)
  })

  it('keeps the same getter across renders, so the provider does not churn', () => {
    const { result, rerender } = renderHook(() => useOverlayLayer())
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })

  it('stacks above the panel, which is itself above the page', () => {
    const { result } = renderHook(() => useOverlayLayer())
    const node = result.current()

    // `relative` is what makes the z-index mean anything: without a position
    // the overlays would rejoin the body's stacking context and the panel
    // would cover them again.
    expect(node?.style.position).toBe('relative')
    expect(Number(node?.style.zIndex)).toBeGreaterThan(2147483000)
  })

  it('takes its node with it, rather than leaving one per open', () => {
    const first = renderHook(() => useOverlayLayer())
    first.unmount()

    expect(layers()).toHaveLength(0)
    expect(first.result.current()).toBeNull()

    const second = renderHook(() => useOverlayLayer())
    second.unmount()

    expect(layers()).toHaveLength(0)
  })
})
