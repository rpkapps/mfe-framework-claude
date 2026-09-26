// @vitest-environment jsdom

/**
 * The canvas mounts anew in the other layout when the page crosses the compact breakpoint, and
 * its columns must follow the element that is there now, not the one that left.
 */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { columnsIn } from './grid.ts'
import { useCanvasColumns } from './use-canvas-columns.ts'

/** Each observer the hook makes, with what it watches, so a test can report a size for it. */
class FakeResizeObserver {
  static made: FakeResizeObserver[] = []
  readonly watching = new Set<Element>()
  disconnected = false

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.made.push(this)
  }
  observe(target: Element): void {
    this.watching.add(target)
  }
  unobserve(target: Element): void {
    this.watching.delete(target)
  }
  disconnect(): void {
    this.watching.clear()
    this.disconnected = true
  }
  resize(target: Element, width: number): void {
    const entry = { target, contentRect: { width } } as unknown as ResizeObserverEntry
    this.callback([entry], this)
  }
}

/** Every live observer watching this element hears it resize, as a browser would report it. */
function resize(target: Element, width: number): void {
  act(() => {
    for (const observer of FakeResizeObserver.made) {
      if (observer.watching.has(target)) observer.resize(target, width)
    }
  })
}

/** The page's two layouts, as far as the canvas goes: each puts the surface somewhere else. */
function Page({ compact }: { readonly compact: boolean }): ReactNode {
  const { surfaceRef, measured } = useCanvasColumns()
  const canvas = createElement('div', {
    ref: surfaceRef,
    'data-surface': '',
    'data-columns': measured ?? 'none',
  })
  return compact ? createElement('section', null, canvas) : createElement('main', null, canvas)
}

let root: Root | undefined

function render(compact: boolean): void {
  act(() => {
    root?.render(createElement(Page, { compact }))
  })
}

function surface(): Element {
  const element = document.querySelector('[data-surface]')
  if (element === null) throw new Error('The surface is not rendered.')
  return element
}

/** What the hook measured, as the surface renders it. */
function columns(): string | null {
  return surface().getAttribute('data-columns')
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  FakeResizeObserver.made = []
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('useCanvasColumns', () => {
  it('has no measure until the surface reports a width', () => {
    render(false)
    expect(columns()).toBe('none')
    resize(surface(), 0)
    expect(columns()).toBe('none')
    resize(surface(), 1200)
    expect(columns()).toBe(String(columnsIn(1200)))
  })

  it('follows the surface into the other layout and lets the old one go', () => {
    render(false)
    const wide = surface()
    resize(wide, 1200)
    expect(columns()).toBe(String(columnsIn(1200)))

    render(true)
    const narrow = surface()
    expect(narrow).not.toBe(wide)
    expect(FakeResizeObserver.made.filter(observer => observer.watching.has(wide))).toEqual([])

    resize(narrow, 600)
    expect(columns()).toBe(String(columnsIn(600)))
  })

  it('stops observing when the page goes', () => {
    render(false)
    act(() => {
      root?.unmount()
    })
    root = undefined
    expect(FakeResizeObserver.made.every(observer => observer.disconnected)).toBe(true)
  })
})
