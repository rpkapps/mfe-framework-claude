import type { ReactNode } from 'react'
import { render, renderHook, screen } from '@testing-library/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@tecton/react/components/dropdown-menu'
import { TectonProvider } from '@tecton/react/tecton/provider'
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

  it('appends one node to the body and hands back that node', () => {
    const { result } = renderHook(() => useOverlayLayer())

    expect(layers()).toHaveLength(1)
    expect(result.current).toBe(layers()[0])
    expect(result.current.parentElement).toBe(document.body)
  })

  it('keeps the same node across renders, so the provider does not churn', () => {
    const { result, rerender } = renderHook(() => useOverlayLayer())
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
    expect(layers()).toHaveLength(1)
  })

  it('stacks above the panel, which is itself above the page', () => {
    const { result } = renderHook(() => useOverlayLayer())
    const node = result.current

    expect(node.style.position).toBe('relative')
    expect(Number(node.style.zIndex)).toBeGreaterThan(2147483000)
  })

  it('takes its node with it, rather than leaving one per open', () => {
    const first = renderHook(() => useOverlayLayer())
    first.unmount()

    expect(layers()).toHaveLength(0)
    expect(first.result.current.isConnected).toBe(false)

    const second = renderHook(() => useOverlayLayer())
    second.unmount()

    expect(layers()).toHaveLength(0)
  })

  // Handed over as the node rather than a getter: the provider calls a getter after its own commit,
  // before the effect of the component that owns the layer, so a getter over a ref read nothing and
  // the menu opened behind the panel.
  it('is where an overlay opened under it portals to, from the first open', async () => {
    function Dock({ children }: { readonly children: ReactNode }): ReactNode {
      const overlays = useOverlayLayer()
      return <TectonProvider portalContainer={overlays}>{children}</TectonProvider>
    }

    render(
      <Dock>
        <DropdownMenu defaultOpen>
          <DropdownMenuContent>
            <DropdownMenuItem>Dock to the top</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Dock>,
    )

    const item = await screen.findByRole('menuitem', { name: 'Dock to the top' })
    expect(layers()[0]?.contains(item)).toBe(true)
  })
})
