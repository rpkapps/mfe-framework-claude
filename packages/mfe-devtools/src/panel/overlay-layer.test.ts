/**
 * The hook is tested rather than the panel because React Aria's `Toolbar` reads an inherited
 * property off `<html>` that this jsdom throws resolving, so the header cannot be rendered here.
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
